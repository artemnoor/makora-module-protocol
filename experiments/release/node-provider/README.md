# Independent Node MMP provider

This fixture implements `org.independent.node` with the public `@artemnoor/mmp` SDK and the official `@modelcontextprotocol/server/stdio` transport.

Install dependencies with `npm install`. `package.json` references the SDK tarball at `../artemnoor-mmp-0.1.0.tgz`; keep that tarball beside this directory. Run it with:

```powershell
$env:LAB_CONTRACT = (Resolve-Path .\reading-contract.json).Path
npm start
```

`LAB_CONTRACT` must name a JSON envelope whose `schema` is the input and output schema and has ID `urn:mmp:independent:reading:1.0.0`. `reading-contract.json` is the fixture envelope.

`classify` sets severity to `review` for amounts of 60 or more and `normal` otherwise, then appends `classified` to `notes`. `normalize` trims `source` and appends `normalized` to `notes`. Both operations are synchronous, read-only, and require no permissions.

Set `LAB_NESTED=1` to make `classify` invoke the separately registered `org.independent/annotate` capability. The descriptor always declares that exact dependency triple. Configure `MMP_GATEWAY` and `MMP_CREDENTIAL` for the SDK's Gateway call; successful Gateway envelopes are unwrapped to their `result`, and Gateway errors are returned unchanged.

Run `npm run check:syntax` for the JavaScript syntax check.
