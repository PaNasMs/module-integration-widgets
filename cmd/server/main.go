package main

import (
	"log"
	"net/http"

	"github.com/PaNasMs/module-integration-widgets/internal/widgets"
	"github.com/PaNasMs/module-sdk/modulehost"
)

func main() {
	modulehost.Serve("integration-widgets", func(_ map[string]bool) http.Handler {
		service, err := widgets.New("/var/lib/panasms-integration-widgets")
		if err != nil {
			log.Fatal(err)
		}
		return service
	})
}
