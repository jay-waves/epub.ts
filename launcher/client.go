package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

var daemonHTTPClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout: 5 * time.Second,
		}).DialContext,
	},
}

func DaemonRunning() (bool, error) {
	running, _, err := daemonStatus()
	return running, err
}

func daemonStatus() (bool, string, error) {
	listenAddress, err := daemonAddress()
	if err != nil || listenAddress == "" {
		return false, "", err
	}
	response, err := daemonRequest(http.MethodGet, listenAddress, "/api/control/status", nil)
	if err != nil {
		return false, "", nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return false, "", fmt.Errorf("check epub.ts daemon: %s", response.Status)
	}
	return true, response.Header.Get("X-EPUB-TS-Build"), nil
}

func StopDaemon() error {
	listenAddress, err := daemonAddress()
	if err != nil || listenAddress == "" {
		return err
	}
	response, err := daemonRequest(http.MethodPost, listenAddress, "/api/control/stop", nil)
	if err != nil {
		// A stale endpoint means the daemon is already stopped.
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		return fmt.Errorf("stop epub.ts daemon: %s", response.Status)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		currentAddress, checkErr := daemonAddress()
		if checkErr != nil {
			return checkErr
		}
		if currentAddress == "" {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return errors.New("epub.ts daemon did not stop within 10 seconds")
}

func RegisterWithDaemon(documentPath string) (string, error) {
	listenAddress, err := daemonAddress()
	if err != nil {
		return "", err
	}
	if listenAddress == "" {
		return "", errors.New("epub.ts daemon is not running")
	}
	payload, err := json.Marshal(map[string]string{"path": documentPath})
	if err != nil {
		return "", fmt.Errorf("encode document registration: %w", err)
	}
	response, err := daemonRequest(http.MethodPost, listenAddress, "/api/control/documents", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("connect to epub.ts daemon at %s: %w", listenAddress, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = response.Status
		}
		return "", fmt.Errorf("register document: %s", message)
	}
	var result openResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode daemon response: %w", err)
	}
	if result.URL == "" {
		return "", errors.New("epub.ts daemon returned an empty viewer URL")
	}
	return result.URL, nil
}

func daemonAddress() (string, error) {
	registry, err := OpenRegistry()
	if err != nil {
		return "", err
	}
	return registry.Endpoint(), nil
}

func daemonRequest(method, listenAddress, path string, body io.Reader) (*http.Response, error) {
	request, err := http.NewRequest(method, "http://"+listenAddress+path, body)
	if err != nil {
		return nil, fmt.Errorf("create daemon request: %w", err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := daemonHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	return response, nil
}
