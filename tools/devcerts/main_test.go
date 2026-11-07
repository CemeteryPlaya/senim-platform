package main

import (
	"os"
	"path/filepath"
	"testing"
)

func caPaths(dir string) (cert, key string) {
	return filepath.Join(dir, "ca"+certExt), filepath.Join(dir, "ca"+keySuffix)
}

func TestLoadOrCreateCACreatesAndReuses(t *testing.T) {
	dir := t.TempDir()
	c1, k1, err := loadOrCreateCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	c2, k2, err := loadOrCreateCA(dir)
	if err != nil {
		t.Fatal(err)
	}
	if string(c1) != string(c2) || string(k1) != string(k2) {
		t.Fatal("existing CA was replaced")
	}
}

func TestLoadOrCreateCAHalfStates(t *testing.T) {
	cases := map[string]string{"cert only": "cert", "key only": "key"}
	for name, keep := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			if _, _, err := loadOrCreateCA(dir); err != nil {
				t.Fatal(err)
			}
			certPath, keyPath := caPaths(dir)
			remove, kept := keyPath, certPath
			if keep == "key" {
				remove, kept = certPath, keyPath
			}
			if err := os.Remove(remove); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(kept)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := loadOrCreateCA(dir); err == nil {
				t.Fatal("incomplete CA must be an error")
			}
			after, err := os.ReadFile(kept)
			if err != nil || string(before) != string(after) {
				t.Fatal("remaining CA file was modified")
			}
			if _, err := os.Stat(remove); !os.IsNotExist(err) {
				t.Fatal("missing CA file must not be recreated")
			}
		})
	}
}
