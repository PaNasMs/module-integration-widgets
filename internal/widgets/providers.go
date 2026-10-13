package widgets

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var errUnauthorized = errors.New("unauthorized")
var errUnsupported = errors.New("unsupported metric")
var entityID = regexp.MustCompile(`^[a-z][a-z0-9_]*\.[a-zA-Z0-9_]+$`)

type Metric struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Unit  string `json:"unit,omitempty"`
	ID    string `json:"id,omitempty"`
}
type Volume struct {
	ID     string `json:"id"`
	Total  uint64 `json:"total"`
	Used   uint64 `json:"used"`
	Status string `json:"status"`
}
type Snapshot struct {
	Type              string    `json:"type"`
	CPU               *float64  `json:"cpu,omitempty"`
	MemoryUsed        uint64    `json:"memoryUsed,omitempty"`
	MemoryTotal       uint64    `json:"memoryTotal,omitempty"`
	Nodes             int       `json:"nodes,omitempty"`
	VMs               int       `json:"vms,omitempty"`
	VMsRunning        int       `json:"vmsRunning,omitempty"`
	Containers        int       `json:"containers,omitempty"`
	ContainersRunning int       `json:"containersRunning,omitempty"`
	Volumes           []Volume  `json:"volumes,omitempty"`
	Metrics           []Metric  `json:"metrics,omitempty"`
	ObservedAt        time.Time `json:"observedAt"`
}

func client(c Connection) *http.Client {
	return &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: c.SkipTLSVerify}}}
}

func requestJSON(ctx context.Context, h *http.Client, method, address string, headers map[string]string, body io.Reader, target any) error {
	req, err := http.NewRequestWithContext(ctx, method, address, body)
	if err != nil {
		return err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := h.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return errUnauthorized
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(target)
}

func fetch(ctx context.Context, c Connection, options url.Values) (Snapshot, error) {
	switch c.Type {
	case "proxmox":
		return proxmox(ctx, c)
	case "synology":
		return synology(ctx, c)
	case "home-assistant":
		return homeAssistant(ctx, c, options)
	}
	return Snapshot{}, errUnsupported
}

func probe(ctx context.Context, c Connection) error {
	if c.Type == "home-assistant" {
		address, err := url.JoinPath(c.URL, "api/")
		if err != nil {
			return err
		}
		var response map[string]any
		return requestJSON(ctx, client(c), "GET", address, map[string]string{"Authorization": "Bearer " + c.Secret}, nil, &response)
	}
	_, err := fetch(ctx, c, nil)
	return err
}

func proxmox(ctx context.Context, c Connection) (Snapshot, error) {
	address, err := url.JoinPath(c.URL, "api2/json/cluster/resources")
	if err != nil {
		return Snapshot{}, err
	}
	var payload struct {
		Data []struct {
			Type   string  `json:"type"`
			Status string  `json:"status"`
			CPU    float64 `json:"cpu"`
			MaxCPU float64 `json:"maxcpu"`
			Mem    uint64  `json:"mem"`
			MaxMem uint64  `json:"maxmem"`
		} `json:"data"`
	}
	err = requestJSON(ctx, client(c), "GET", address, map[string]string{"Authorization": "PVEAPIToken=" + c.Secret}, nil, &payload)
	if err != nil {
		return Snapshot{}, err
	}
	result := Snapshot{Type: c.Type, ObservedAt: time.Now(), Volumes: []Volume{}, Metrics: []Metric{}}
	var weighted, capacity float64
	for _, item := range payload.Data {
		switch item.Type {
		case "node":
			result.Nodes++
			if item.Status == "online" {
				weighted += item.CPU * item.MaxCPU
				capacity += item.MaxCPU
				result.MemoryUsed += item.Mem
				result.MemoryTotal += item.MaxMem
			}
		case "qemu":
			result.VMs++
			if item.Status == "running" {
				result.VMsRunning++
			}
		case "lxc":
			result.Containers++
			if item.Status == "running" {
				result.ContainersRunning++
			}
		}
	}
	if capacity > 0 {
		percent := 100 * weighted / capacity
		result.CPU = &percent
	}
	return result, nil
}

func synology(ctx context.Context, c Connection) (Snapshot, error) {
	h := client(c)
	loginURL, err := url.JoinPath(c.URL, "webapi/auth.cgi")
	if err != nil {
		return Snapshot{}, err
	}
	form := url.Values{"api": {"SYNO.API.Auth"}, "version": {"7"}, "method": {"login"}, "account": {c.Username}, "passwd": {c.Secret}, "session": {"DSM"}, "format": {"sid"}}
	var auth struct {
		Success bool `json:"success"`
		Data    struct {
			SID string `json:"sid"`
		} `json:"data"`
	}
	err = requestJSON(ctx, h, "POST", loginURL, map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, strings.NewReader(form.Encode()), &auth)
	if err != nil {
		return Snapshot{}, err
	}
	if !auth.Success || auth.Data.SID == "" {
		return Snapshot{}, errUnauthorized
	}
	sid := auth.Data.SID
	defer func() {
		logout := url.Values{"api": {"SYNO.API.Auth"}, "version": {"7"}, "method": {"logout"}, "session": {"DSM"}, "_sid": {sid}}
		_, _ = h.PostForm(loginURL, logout)
	}()
	entry, err := url.JoinPath(c.URL, "webapi/entry.cgi")
	if err != nil {
		return Snapshot{}, err
	}
	query := url.Values{"api": {"SYNO.Core.Storage.Volume"}, "version": {"1"}, "method": {"list"}, "limit": {"-1"}, "offset": {"0"}, "location": {"internal"}, "_sid": {sid}}
	var volumes struct {
		Success bool `json:"success"`
		Data    struct {
			Volumes []struct {
				Path   string `json:"volume_path"`
				Total  string `json:"size_total_byte"`
				Free   string `json:"size_free_byte"`
				Status string `json:"status"`
			} `json:"volumes"`
		} `json:"data"`
	}
	err = requestJSON(ctx, h, "GET", entry+"?"+query.Encode(), nil, nil, &volumes)
	if err != nil {
		return Snapshot{}, err
	}
	if !volumes.Success {
		return Snapshot{}, errUnsupported
	}
	result := Snapshot{Type: c.Type, ObservedAt: time.Now(), Volumes: []Volume{}, Metrics: []Metric{}}
	for _, item := range volumes.Data.Volumes {
		total, _ := strconv.ParseUint(item.Total, 10, 64)
		free, _ := strconv.ParseUint(item.Free, 10, 64)
		if free > total {
			free = total
		}
		result.Volumes = append(result.Volumes, Volume{ID: item.Path, Total: total, Used: total - free, Status: item.Status})
	}
	query = url.Values{"api": {"SYNO.Core.System.Utilization"}, "version": {"1"}, "method": {"get"}, "_sid": {sid}}
	var utilization struct {
		Success bool `json:"success"`
		Data    struct {
			CPU struct {
				TotalLoad *float64 `json:"total_load"`
			} `json:"cpu"`
			Memory struct {
				RealUsage *float64 `json:"real_usage"`
			} `json:"memory"`
		} `json:"data"`
	}
	if requestJSON(ctx, h, "GET", entry+"?"+query.Encode(), nil, nil, &utilization) == nil && utilization.Success {
		result.CPU = utilization.Data.CPU.TotalLoad
		if utilization.Data.Memory.RealUsage != nil {
			result.Metrics = append(result.Metrics, Metric{Label: "memory", Value: strconv.FormatFloat(*utilization.Data.Memory.RealUsage, 'f', 0, 64), Unit: "%"})
		}
	}
	return result, nil
}

func homeAssistant(ctx context.Context, c Connection, options url.Values) (Snapshot, error) {
	result := Snapshot{Type: c.Type, ObservedAt: time.Now(), Metrics: []Metric{}, Volumes: []Volume{}}
	h := client(c)
	for _, key := range []string{"primary", "secondary", "tertiary"} {
		id := options.Get(key)
		if id == "" {
			continue
		}
		if !entityID.MatchString(id) {
			return Snapshot{}, errUnsupported
		}
		address, err := url.JoinPath(c.URL, "api/states", id)
		if err != nil {
			return Snapshot{}, err
		}
		var state struct {
			EntityID   string `json:"entity_id"`
			State      string `json:"state"`
			Attributes struct {
				FriendlyName string `json:"friendly_name"`
				Unit         string `json:"unit_of_measurement"`
			} `json:"attributes"`
		}
		err = requestJSON(ctx, h, "GET", address, map[string]string{"Authorization": "Bearer " + c.Secret}, nil, &state)
		if err != nil {
			return Snapshot{}, err
		}
		label := state.Attributes.FriendlyName
		if label == "" {
			label = id
		}
		result.Metrics = append(result.Metrics, Metric{Label: label, Value: state.State, Unit: state.Attributes.Unit, ID: id})
	}
	return result, nil
}
