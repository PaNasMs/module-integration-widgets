package widgets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

type Connection struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Username      string `json:"username,omitempty"`
	Secret        string `json:"secret,omitempty"`
	SkipTLSVerify bool   `json:"skipTLSVerify,omitempty"`
}

type publicConnection struct {
	ID            string `json:"id"`
	Type          string `json:"type"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Username      string `json:"username,omitempty"`
	SkipTLSVerify bool   `json:"skipTLSVerify,omitempty"`
}

func (c Connection) public() publicConnection {
	return publicConnection{c.ID, c.Type, c.Name, c.URL, c.Username, c.SkipTLSVerify}
}

type Service struct {
	mu          sync.Mutex
	root        string
	key         []byte
	connections []Connection
}

func New(root string) (*Service, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	keyPath := filepath.Join(root, "key")
	key, err := os.ReadFile(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		key = make([]byte, 32)
		if _, err = io.ReadFull(rand.Reader, key); err != nil {
			return nil, err
		}
		file, e := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return nil, e
		}
		_, err = file.Write(key)
		closeErr := file.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid encryption key")
	}
	s := &Service{root: root, key: key, connections: []Connection{}}
	raw, err := os.ReadFile(filepath.Join(root, "connections.enc"))
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, fmt.Errorf("invalid encrypted connections")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(plain, &s.connections); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Service) save() error {
	plain, err := json.Marshal(s.connections)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	raw := gcm.Seal(nonce, nonce, plain, nil)
	file, err := os.CreateTemp(s.root, "connections-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(s.root, "connections.enc"))
}
