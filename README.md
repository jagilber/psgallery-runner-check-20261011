# Hosted PowerShell Gallery Check

Temporary, synthetic public test fixture for comparing a pinned Az installation on standard GitHub-hosted macOS Intel and Linux x64 runners. Manual dispatch only; no self-hosted runner, Azure login, secrets, customer code or customer data.

The matrix runs PowerShellGet and PSResourceGet on each OS with verified PowerShell 7.6.6 release downloads and Az 16.4.0. Every job records the actual image/runtime/package-manager versions, UTC boundaries, installation duration and result. A failed test remains a failed test. Result artifacts expire after two days.

Standard hosted runner labels do not select geographic region. This tests GitHub-managed placement, not a region-matched environment. Actual image versions may change between runs and are recorded rather than inferred from labels.

Job runtime is capped at 95 minutes; two jobs may run concurrently. Download timeout and byte limits, disabled core dumps and a per-file size ceiling limit local resource use. The isolated hosted VM supplies the hardware/CPU ceiling and is discarded by GitHub. These are synthetic lab tests, NOT CUSTOMER-READY diagnostic collectors or production procedures.

## Diagnostics Comparison

Manual dispatch inputs: `debug` (boolean, defaults false) and `platform` (`both`, `macos`, `linux`). Each dispatch runs both package managers. Run once with debug false, then once with debug true to compare four matched OS/manager pairs. Public artifacts contain synthetic package-install data only; no customer input or cloud authentication.

Both modes use fresh isolated module/cache homes, PowerShell 7.6.6 and Az 16.4.0. The debug mode passes `-Debug -Verbose` explicitly to installation and import; normal mode omits both. Commands run sequentially in the same PowerShell process with separate UTC markers and monotonic durations. Package-manager versions and resolved installed/imported graphs are recorded, not assumed.

Each job preserves `console.txt`, `events.jsonl`, `summary.json` and independent `supervisor.json`, plus GitHub's ordinary timestamped Actions log. Stream records distinguish emitted Debug/Verbose/Warning/Error messages by phase. The normal log includes our phase markers; it is customer-like, not byte-identical to an uninstrumented workflow. Diagnostics expose existing messages, not guaranteed HTTP headers or network traces.

The Node supervisor uses no external packages. It enforces an 85-minute total deadline, 75-minute install and 15-minute import ceilings, 64 MiB combined readable/structured output, 2 GiB workload-home bytes with a bounded file census, and an 8 GiB free-space reserve. Storage is sampled every two seconds; timeout checks run every 100 ms. A safety stop kills only its own process group and preserves partial logs plus an independent reason code. It is not an installation failure unless the workload itself failed. Dotnet's GC heap is capped at 2 GiB; overall process memory and CPU remain bounded by the disposable hosted VM, not measured as customer equivalence.

`node test-supervisor.mjs` exercises real normal/error/deadline/output/storage paths without installing packages or using credentials. It removes only its uniquely created synthetic test directories. The workflow runs this gate before each real cell. Hosted results are comparisons, not proof of matching customer OS, egress, image, caches or full dependency versions. Hosted macOS image is recorded and cannot be assumed to equal another major OS version.
