# Vercel Production Testing

Production URL:

```text
https://tax-calculator-ochre-phi.vercel.app
```

Run all Playwright browser tests against production:

```powershell
npm run test:e2e:vercel
```

Run only the deployment smoke checks:

```powershell
npm run test:e2e:vercel -- --grep "Production deployment smoke"
```

Override the target URL for preview deployments:

```powershell
$env:VERCEL_TEST_URL="https://your-preview-url.vercel.app"
npm run test:e2e:vercel
```

The production runner sets `PLAYWRIGHT_BASE_URL` and skips the local web server. It verifies the deployed static UI and deployed `/api/v1/*` functions instead of the local Node server.
