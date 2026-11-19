// Command vapid prints a new key pair for web push alerts:
//
//	go run ./cmd/vapid
//
// Set them as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (e.g. fly secrets set).
package main

import (
	"fmt"
	"log"

	"mayelai/server/internal/push"
)

func main() {
	priv, pub, err := push.GenerateKeys()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", pub, priv)
}
