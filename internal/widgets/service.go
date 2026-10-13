package widgets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func problem(w http.ResponseWriter, status int, message string) {
	respond(w, status, map[string]string{"error": message})
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil || d.Decode(new(any)) != io.EOF {
		problem(w, 400, "Invalid request")
		return false
	}
	return true
}

func validConnection(c Connection) bool {
	if len(c.Name) == 0 || len(c.Name) > 80 || len(c.URL) == 0 || len(c.URL) > 500 || len(c.Username) > 200 || len(c.Secret) > 4096 {
		return false
	}
	if c.Type != "proxmox" && c.Type != "synology" && c.Type != "home-assistant" {
		return false
	}
	u, err := url.Parse(c.URL)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && !strings.ContainsAny(c.Name, "\r\n")
}

func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(r.URL.Path, "/")
	admin := r.Header.Get("X-PaNasMs-Role") == "admin"
	switch {
	case path == "connections" && r.Method == http.MethodGet:
		if !admin {
			problem(w, 403, "Administrator permissions required")
			return
		}
		s.mu.Lock()
		list := make([]publicConnection, 0, len(s.connections))
		for _, c := range s.connections {
			list = append(list, c.public())
		}
		s.mu.Unlock()
		sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
		respond(w, 200, list)
	case path == "connections/test" && r.Method == http.MethodPost:
		if !admin {
			problem(w, 403, "Administrator permissions required")
			return
		}
		var c Connection
		if !decode(w, r, &c) {
			return
		}
		if c.ID != "" && c.Secret == "" {
			s.mu.Lock()
			for _, old := range s.connections {
				if old.ID == c.ID {
					c.Secret = old.Secret
					break
				}
			}
			s.mu.Unlock()
		}
		if !validConnection(c) || c.Secret == "" || (c.Type == "synology" && c.Username == "") {
			problem(w, 400, "Incomplete connection")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		if err := probe(ctx, c); err != nil {
			problem(w, 502, publicError(err))
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	case path == "connections" && r.Method == http.MethodPost:
		if !admin {
			problem(w, 403, "Administrator permissions required")
			return
		}
		var c Connection
		if !decode(w, r, &c) {
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		found := -1
		for i, old := range s.connections {
			if c.ID != "" && c.ID == old.ID {
				found = i
				if c.Secret == "" {
					c.Secret = old.Secret
				}
				break
			}
		}
		if !validConnection(c) || c.Secret == "" || (c.Type == "synology" && c.Username == "") {
			problem(w, 400, "Incomplete connection")
			return
		}
		previous := append([]Connection(nil), s.connections...)
		if found < 0 {
			if c.ID != "" || len(s.connections) >= 32 {
				problem(w, 400, "Invalid connection")
				return
			}
			id := make([]byte, 16)
			if _, err := rand.Read(id); err != nil {
				problem(w, 500, "Could not create connection")
				return
			}
			c.ID = hex.EncodeToString(id)
			s.connections = append(s.connections, c)
		} else {
			s.connections[found] = c
		}
		if err := s.save(); err != nil {
			s.connections = previous
			problem(w, 500, "Could not save connection")
			return
		}
		respond(w, 200, c.public())
	case strings.HasPrefix(path, "connections/") && r.Method == http.MethodDelete:
		if !admin {
			problem(w, 403, "Administrator permissions required")
			return
		}
		id := strings.TrimPrefix(path, "connections/")
		s.mu.Lock()
		defer s.mu.Unlock()
		index := -1
		for i, c := range s.connections {
			if c.ID == id {
				index = i
				break
			}
		}
		if index < 0 {
			problem(w, 404, "Connection not found")
			return
		}
		previous := append([]Connection(nil), s.connections...)
		s.connections = append(s.connections[:index], s.connections[index+1:]...)
		if err := s.save(); err != nil {
			s.connections = previous
			problem(w, 500, "Could not delete connection")
			return
		}
		respond(w, 200, map[string]bool{"deleted": true})
	case path == "snapshot" && r.Method == http.MethodGet:
		if !admin {
			problem(w, 403, "Administrator permissions required")
			return
		}
		id := r.URL.Query().Get("id")
		s.mu.Lock()
		var c Connection
		for _, item := range s.connections {
			if item.ID == id {
				c = item
				break
			}
		}
		s.mu.Unlock()
		if c.ID == "" {
			problem(w, 404, "Connection not found")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		snapshot, err := fetch(ctx, c, r.URL.Query())
		if err != nil {
			problem(w, 502, publicError(err))
			return
		}
		respond(w, 200, snapshot)
	default:
		problem(w, 404, "Not found")
	}
}

func publicError(err error) string {
	if errors.Is(err, errUnauthorized) {
		return "Authentication failed"
	}
	if errors.Is(err, errUnsupported) {
		return "Metric unavailable"
	}
	return "Service unavailable"
}
