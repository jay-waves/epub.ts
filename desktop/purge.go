package main

import (
	"fmt"
	"os"
)

// Purge removes data owned by the current user. Platform packages remain
// responsible for installing and uninstalling the launcher itself.
func Purge() error {
	if err := StopDaemon(); err != nil {
		return fmt.Errorf("stop epub.ts daemon: %w", err)
	}
	directory, err := defaultStateDir()
	if err != nil {
		return err
	}
	if err := os.RemoveAll(directory); err != nil {
		return fmt.Errorf("remove epub.ts application data: %w", err)
	}
	return nil
}
