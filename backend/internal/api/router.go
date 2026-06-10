package api

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the Gin engine with middleware and all v1 routes.
func NewRouter(h *Handlers) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger(), cors())

	r.GET("/healthz", func(c *gin.Context) { c.String(200, "ok") })

	v1 := r.Group("/api/v1")
	{
		v1.POST("/documents", h.Upload)
		v1.GET("/documents", h.List)
		v1.GET("/documents/:id", h.Download)
		v1.GET("/documents/:id/meta", h.Meta)
		v1.GET("/documents/:id/versions", h.ListVersions)
		v1.GET("/documents/:id/versions/:n", h.DownloadVersion)
		v1.POST("/documents/:id/versions/:n/restore", h.RestoreVersion)
		v1.POST("/documents/:id/pages/ops", h.PageOps)
		v1.POST("/documents/:id/split", h.Split)
		v1.POST("/documents/merge", h.Merge)
	}
	return r
}

// requestLogger logs every request with slog (structured, one line each).
func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		slog.Info("request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"dur", time.Since(start).Round(time.Microsecond).String(),
		)
	}
}

// cors allows the Vite dev server origin; same-origin in production via the
// nginx proxy, so a permissive policy here is acceptable for this project.
func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
