# Security

The local profile supports trusted installed modules over private stdio and an authenticated loopback Gateway. See the [threat boundary and requirements](spec/0.1.0/security.md).

The Reference Host checks the bound loopback authority and rejects cross-origin requests to its Gateway. Operator pins identify verified package and contract bytes. Publisher verification and OS isolation are responsibilities of the deployment. Keep the Gateway and module credentials private, and treat operation output as untrusted data.

To report a security issue, contact the repository maintainer privately with the affected revision, impact and a safe minimal reproduction. Keep credentials and unrelated environment data out of the report.
