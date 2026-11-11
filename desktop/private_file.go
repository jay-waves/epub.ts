package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func writePrivateFileAtomically(path, tempPattern, description string, content []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), tempPattern)
	if err != nil {
		return fmt.Errorf("create temporary %s: %w", description, err)
	}
	tempPath := temp.Name()
	defer func() {
		_ = temp.Close()
		_ = os.Remove(tempPath)
	}()

	if err := temp.Chmod(0o600); err != nil {
		return fmt.Errorf("protect %s: %w", description, err)
	}
	if _, err := temp.Write(content); err != nil {
		return fmt.Errorf("write %s: %w", description, err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("flush %s: %w", description, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close %s: %w", description, err)
	}
	if err := atomicReplace(tempPath, path); err != nil {
		return fmt.Errorf("replace %s: %w", description, err)
	}
	return nil
}
