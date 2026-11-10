package pii

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"testing"
)

func TestIndexDomainsSeparate(t *testing.T) {
	idx := NewIndex(key('i'))
	x := "900101300123"
	if bytes.Equal(idx.Of(DomainIIN, x), idx.Of(DomainBINIIN, x)) {
		t.Fatal("Of(iin, x) == Of(bin_iin, x)")
	}
	if !bytes.Equal(idx.Of(DomainIIN, x), idx.Of(DomainIIN, x)) {
		t.Fatal("index is not deterministic")
	}
	if bytes.Equal(idx.Of(DomainIIN, x), NewIndex(key('j')).Of(DomainIIN, x)) {
		t.Fatal("index does not depend on the key")
	}
	// HMAC-SHA256(key, domain ‖ 0x00 ‖ value).
	m := hmac.New(sha256.New, key('i'))
	m.Write([]byte("iin\x00" + x))
	if !bytes.Equal(idx.Of(DomainIIN, x), m.Sum(nil)) {
		t.Fatal("index differs from HMAC-SHA256(key, domain||0x00||value)")
	}
}

func TestIndexDoesNotAliasKey(t *testing.T) {
	k := key('i')
	idx := NewIndex(k)
	want := idx.Of(DomainIIN, "x")
	k[0] ^= 0xff
	if !bytes.Equal(idx.Of(DomainIIN, "x"), want) {
		t.Fatal("index key aliases the caller's slice")
	}
}
