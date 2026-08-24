package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func Install(executable string) error {
	absolute, err := filepath.Abs(executable)
	if err != nil {
		return fmt.Errorf("resolve epub.ts executable: %w", err)
	}
	if canonical, canonicalErr := filepath.EvalSymlinks(absolute); canonicalErr == nil {
		absolute = canonical
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return fmt.Errorf("inspect epub.ts executable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("epub.ts executable is not a regular file: %s", absolute)
	}
	if err := installAssociations(absolute); err != nil {
		return fmt.Errorf("install epub.ts file associations: %w", err)
	}
	return nil
}

func Uninstall(purge bool) error {
	if purge {
		if err := StopDaemon(); err != nil {
			return fmt.Errorf("stop epub.ts daemon: %w", err)
		}
	}
	if err := uninstallAssociations(); err != nil {
		return fmt.Errorf("uninstall epub.ts file associations: %w", err)
	}
	if purge {
		directory, err := defaultStateDir()
		if err != nil {
			return err
		}
		if err := os.RemoveAll(directory); err != nil {
			return fmt.Errorf("remove epub.ts application data: %w", err)
		}
	}
	return nil
}
