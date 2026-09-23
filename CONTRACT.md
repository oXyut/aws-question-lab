# Internal implementation contract

Types and Zod schemas live in `shared/schema.ts`. All API responses use JSON except SSE, images, and HTML export. Error responses: `{error:{code,message}}`.

- `GET /api/health` → `Health`.
- `POST /api/extract` multipart `text` (optional), `images` (repeatable PNG/JPEG/WebP, max 5 × 10 MiB), optional `knownAnswer` and `originalExplanation` strings → 202 `{job: GenerationJob}`. Result has `draft`.
- `POST /api/generate` JSON `{question: QuestionDraft}` → 202 `{job}`. Result has documentId and revisionId.
- `POST /api/documents/:id/followups` JSON `{revisionId:string,prompt:string}` → 202 `{job}`. Server creates a new effective question by appending the follow-up to the selected revision's question text. Original document and previous revisions remain unchanged. Research again; generate a whole revised explanation, never an unsafe JSON patch.
- `GET /api/jobs/:id` → `{job}`; `GET /api/jobs/:id/events` emits SSE `event: job`, data is a whole GenerationJob. Send current snapshot immediately, close at terminal status. Cancellation `POST /api/jobs/:id/cancel` → `{job}`; retry `POST /api/jobs/:id/retry` → 202 `{job}`. Only one active CLI generation; reject concurrent submissions with 409 BUSY. Retain payload in private local job persistence for retry after failure/restart.
- `GET /api/documents` → `{documents:DocumentSummary[]}`; `GET /api/documents/:id` → `{document:ExplanationDocument}`; `DELETE /api/documents/:id` → `{ok:true}`.
- `GET /api/images/:id` → image bytes, validate IDs, never accept caller paths.
- `GET /api/documents/:id/export?revisionId=...` → self-contained HTML attachment of the selected revision.

Frontend public module: `src/components/ExplanationViewer.tsx` exports `ExplanationViewer` with props `{revision:ExplanationRevision, iconBase?:string, iconMap?:Record<string,string>}`. Assets normally `/aws-icons/<file>.svg`; export supplies iconMap of data URLs by service key. Component imports its own CSS or shared `src/styles.css` (export entry imports that stylesheet). Viewer owns selection and diagram interaction; app owns generation, history and revision selection.

HTML export module: `server/export.ts` exports `renderExport(document:ExplanationDocument, revisionId?:string):Promise<string>`. Build script `scripts/build-export.ts` creates dist/export/viewer.js and viewer.css (IIFE/no runtime imports); `src/export.tsx` hydrates `window.__QUESTION_LAB_EXPORT__={revision,icons}`. Export auto-build in dev if missing, cache bundle only within process, use app-root paths independent of CWD. Escape `<`, U+2028/U+2029 in embedded JSON and all HTML title text. No AI/network functions in offline HTML.

Service icons module `shared/icons.ts`: exports `serviceIcons:Record<string,string>` of service id to filename and `iconFileFor(service:string|null):string|null` with normalized AWS aliases. Supplied official SVGs unmodified with source manifest/attribution. Frontend must fall back to a labeled generic node.

Fixtures: `shared/demo.ts` exports `demoDocument:ExplanationDocument`; this is clearly labeled fictional/sample material, never presented as a newly generated result.

Runtime default port 4317, loopback only. Store private JSON/images/settings in `.local/` or QUESTION_LAB_DATA_DIR. Model selection is `gpt-6-luna` by default and persists in `.local/settings.json`; it is independent from Codex CLI model configuration. `QUESTION_LAB_MODEL` only sets the initial model when no saved choice exists. Authentication stays with installed Codex. No fake success or fake generation percent.
