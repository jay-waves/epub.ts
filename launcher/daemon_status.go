package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const daemonStatusFilename = "daemon-status.json"

type daemonFailure struct {
	Error    string    `json:"error"`
	FailedAt time.Time `json:"failedAt"`
}

func RecordDaemonError(cause error) error {
	if cause == nil {
		return errors.New("daemon error is required")
	}
	directory, err := ensureStateDir()
	if err != nil {
		return err
	}
	content, err := json.MarshalIndent(daemonFailure{
		Error:    cause.Error(),
		FailedAt: time.Now(),
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode daemon status: %w", err)
	}
	return writePrivateFileAtomically(
		filepath.Join(directory, daemonStatusFilename),
		".epub.ts-status-*",
		"daemon status",
		content,
	)
}

func LastDaemonError() (*daemonFailure, error) {
	directory, err := ensureStateDir()
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(filepath.Join(directory, daemonStatusFilename))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read daemon status: %w", err)
	}
	var failure daemonFailure
	if err := json.Unmarshal(content, &failure); err != nil {
		return nil, fmt.Errorf("decode daemon status: %w", err)
	}
	return &failure, nil
}

func ClearDaemonError() error {
	directory, err := ensureStateDir()
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(directory, daemonStatusFilename)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear daemon status: %w", err)
	}
	return nil
}
