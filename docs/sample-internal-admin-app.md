# Sample Internal Admin App

The sample internal admin app lives in `examples/internal-admin-app/`. It demonstrates how an elevated operator surface can use Access Kit without becoming a shortcut around application authorization.

## What It Demonstrates

- Admin/operator authorization through a separate admin ReBAC graph.
- Approval evidence tied to access-review context before sensitive explain or exception actions.
- Safe explain output that keeps raw relationship paths out of the admin response body.
- Break-glass handling that requires incident context, multi-role approval, short duration, notification-ready controls, and post-action review.
- Audit traceability for admin authorization decisions and completed, denied, or approval-pending admin actions.

## What It Avoids

- No local role fallback from application sessions.
- No production secrets or bearer tokens in source.
- No standing break-glass grant to the admin console.
- No raw relationship path exposure in safe explain responses.
- No claim that synthetic evidence is production authorization to operate.

## Validation

Run the focused checks with:

```sh
pnpm validate:sample-admin-app
```

The full repository proof report also includes the sample admin app validation command.
