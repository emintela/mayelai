package fin

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// sealer encrypts Plaid access tokens at rest (AES-256-GCM).
type sealer struct{ aead cipher.AEAD }

// newSealer takes a base64 key of 32 bytes (FIN_TOKEN_KEY; make one with
// `openssl rand -base64 32`).
func newSealer(keyB64 string) (*sealer, error) {
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil || len(key) != 32 {
		return nil, errors.New("FIN_TOKEN_KEY must be 32 bytes, base64 (openssl rand -base64 32)")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &sealer{aead: aead}, nil
}

func (s *sealer) seal(plain string) []byte {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		panic(err)
	}
	return s.aead.Seal(nonce, nonce, []byte(plain), nil)
}

func (s *sealer) open(box []byte) (string, error) {
	n := s.aead.NonceSize()
	if len(box) < n {
		return "", fmt.Errorf("sealed token too short")
	}
	plain, err := s.aead.Open(nil, box[:n], box[n:], nil)
	return string(plain), err
}
