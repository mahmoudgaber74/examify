# Examify OpenCV OMR Service

Local-only, production-oriented OMR implementation. It is an independent FastAPI service and must be called through a trusted server-side adapter, never directly from React.

```powershell
docker build -t examify-omr-service services/omr-service
docker run --rm -p 127.0.0.1:18080:8080 --env-file services/omr-service/.env.example examify-omr-service
Invoke-WebRequest http://127.0.0.1:18080/health
```

`POST /v1/omr/analyze` accepts one `content_base64` source for local tests or a short-lived localhost `signed_url`. Requests require `X-OMR-Service-Token`, or an HMAC signature over `timestamp.request_id.body`. Request IDs are replay-protected in memory. The response includes per-question fill scores, confidence, status, answer-key comparison, bounding boxes, warnings, and annotated images.

PDFs are rasterized inside the service with pypdfium2 at a bounded DPI/page count. No PDF is sent to the browser Canvas scanner.
