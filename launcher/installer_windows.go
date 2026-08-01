//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
)

const classesRoot = `HKCU\Software\Classes\`

func installAssociations(executable string) error {
	openCommand := `"` + executable + `" open "%1"`
	icon := `"` + executable + `",0`
	keys := []struct {
		path         string
		defaultValue string
		values       map[string]string
	}{
		{`epub.ts.Document`, "epub.ts Document", map[string]string{"FriendlyTypeName": "epub.ts Document"}},
		{`epub.ts.Document\Application`, "", map[string]string{
			"ApplicationName":        "epub.ts",
			"ApplicationDescription": "Open EPUB documents with epub.ts",
		}},
		{`epub.ts.Document\DefaultIcon`, icon, nil},
		{`epub.ts.Document\shell\open\command`, openCommand, nil},
	}
	for _, extension := range []string{".epub"} {
		keys = append(keys, struct {
			path         string
			defaultValue string
			values       map[string]string
		}{extension + `\OpenWithProgids`, "", map[string]string{"epub.ts.Document": ""}})
	}
	for _, key := range keys {
		if err := setRegistryDefault(classesRoot+key.path, key.defaultValue); err != nil {
			return err
		}
		for name, value := range key.values {
			if err := setRegistryValue(classesRoot+key.path, name, value); err != nil {
				return err
			}
		}
	}
	return nil
}

func uninstallAssociations() error {
	if err := deleteRegistryTree(classesRoot + `epub.ts.Document`); err != nil {
		return err
	}
	for _, extension := range []string{".epub"} {
		if err := deleteRegistryValue(classesRoot+extension+`\OpenWithProgids`, "epub.ts.Document"); err != nil {
			return err
		}
	}
	return nil
}

func setRegistryDefault(key, value string) error {
	return runRegistry("ADD", key, "/ve", "/t", "REG_SZ", "/d", value, "/f")
}

func setRegistryValue(key, name, value string) error {
	return runRegistry("ADD", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f")
}

func deleteRegistryTree(key string) error {
	return deleteRegistry([]string{"DELETE", key, "/f"}, []string{"QUERY", key})
}

func deleteRegistryValue(key, name string) error {
	return deleteRegistry(
		[]string{"DELETE", key, "/v", name, "/f"},
		[]string{"QUERY", key, "/v", name},
	)
}

func deleteRegistry(deleteArgs, queryArgs []string) error {
	err := registryCommand(deleteArgs...).Run()
	if err == nil {
		return nil
	}
	if queryErr := registryCommand(queryArgs...).Run(); queryErr != nil {
		return nil
	}
	return fmt.Errorf("reg.exe %v: %w", deleteArgs, err)
}

func runRegistry(args ...string) error {
	if output, err := registryCommand(args...).CombinedOutput(); err != nil {
		return fmt.Errorf("reg.exe %v: %w: %s", args, err, output)
	}
	return nil
}

func registryCommand(args ...string) *exec.Cmd {
	command := exec.Command("reg.exe", args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command
}
