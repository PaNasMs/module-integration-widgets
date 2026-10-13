package widgets

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConnectionsAreEncryptedAndAdminOnly(t *testing.T) {
	root := t.TempDir()
	service, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"type":"proxmox","name":"Lab","url":"https://lab.example","secret":"user@pam!card=private-token"}`
	request := httptest.NewRequest("POST", "/connections", strings.NewReader(body))
	response := httptest.NewRecorder()
	service.ServeHTTP(response, request)
	if response.Code != 403 {
		t.Fatalf("member write: %d", response.Code)
	}
	request = httptest.NewRequest("POST", "/connections", strings.NewReader(body))
	request.Header.Set("X-PaNasMs-Role", "admin")
	response = httptest.NewRecorder()
	service.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("admin write: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "private-token") {
		t.Fatal("secret in response")
	}
	raw, err := os.ReadFile(filepath.Join(root, "connections.enc"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "private-token") {
		t.Fatal("secret in state file")
	}
	recovered, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(recovered.connections) != 1 || recovered.connections[0].Secret != "user@pam!card=private-token" {
		t.Fatal("encrypted state did not round trip")
	}
}

func TestMultipleConnectionsOfSameProvider(t *testing.T) {
	service, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Primary", "Backup"} {
		body, _ := json.Marshal(Connection{Type: "proxmox", Name: name, URL: "https://lab.example", Secret: "token"})
		request := httptest.NewRequest("POST", "/connections", strings.NewReader(string(body)))
		request.Header.Set("X-PaNasMs-Role", "admin")
		response := httptest.NewRecorder()
		service.ServeHTTP(response, request)
		if response.Code != 200 {
			t.Fatalf("save %s: %d", name, response.Code)
		}
	}
	if len(service.connections) != 2 || service.connections[0].ID == service.connections[1].ID {
		t.Fatal("connections did not receive independent IDs")
	}
}

func TestProviders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api2/json/cluster/resources":
			if r.Header.Get("Authorization") != "PVEAPIToken=token" {
				t.Error("missing Proxmox token")
			}
			io.WriteString(w, `{"data":[{"type":"node","status":"online","cpu":0.25,"maxcpu":4,"mem":4,"maxmem":8},{"type":"qemu","status":"running"},{"type":"lxc","status":"stopped"}]}`)
		case "/api/states/sensor.room_temperature":
			if r.Header.Get("Authorization") != "Bearer token" {
				t.Error("missing HA token")
			}
			io.WriteString(w, `{"entity_id":"sensor.room_temperature","state":"22.4","attributes":{"friendly_name":"Room","unit_of_measurement":"°C"}}`)
		case "/api/":
			if r.Header.Get("Authorization") != "Bearer token" {
				t.Error("missing HA token in probe")
			}
			io.WriteString(w, `{"message":"API running"}`)
		case "/webapi/auth.cgi":
			if r.FormValue("method") == "login" {
				io.WriteString(w, `{"success":true,"data":{"sid":"session"}}`)
			} else {
				io.WriteString(w, `{"success":true}`)
			}
		case "/webapi/entry.cgi":
			if r.URL.Query().Get("_sid") != "session" {
				t.Error("missing Synology session")
			}
			if r.URL.Query().Get("api") == "SYNO.Core.Storage.Volume" {
				io.WriteString(w, `{"success":true,"data":{"volumes":[{"volume_path":"/volume1","size_total_byte":"1000","size_free_byte":"400","status":"normal"},{"volume_path":"/volume2","size_total_byte":"2000","size_free_byte":"500","status":"normal"}]}}`)
			} else {
				io.WriteString(w, `{"success":true,"data":{"cpu":{"total_load":21},"memory":{"real_usage":48}}}`)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	prox, err := fetch(context.Background(), Connection{Type: "proxmox", URL: server.URL, Secret: "token"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if prox.CPU == nil || *prox.CPU != 25 || prox.MemoryUsed != 4 || prox.VMsRunning != 1 || prox.Containers != 1 {
		t.Fatalf("Proxmox: %+v", prox)
	}
	ha, err := fetch(context.Background(), Connection{Type: "home-assistant", URL: server.URL, Secret: "token"}, url.Values{"primary": {"sensor.room_temperature"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(ha.Metrics) != 1 || ha.Metrics[0].Value != "22.4" || ha.Metrics[0].Unit != "°C" {
		t.Fatalf("HA: %+v", ha)
	}
	if err := probe(context.Background(), Connection{Type: "home-assistant", URL: server.URL, Secret: "token"}); err != nil {
		t.Fatal(err)
	}
	syno, err := fetch(context.Background(), Connection{Type: "synology", URL: server.URL, Username: "viewer", Secret: "password"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(syno.Volumes) != 2 || syno.Volumes[1].Used != 1500 || syno.CPU == nil || *syno.CPU != 21 {
		t.Fatalf("Synology: %+v", syno)
	}
	_, err = json.Marshal(syno)
	if err != nil {
		t.Fatal(err)
	}
}
