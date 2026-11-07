# Quarantined staging proposal

Not runner inputs. No SQL has been executed. Do not rename/copy these candidates into a production migration directory.

0034a commits the enum addition separately; 0034b uses the committed value. Numbers are proposed only, not evidence of migration execution. Original 0018/0023 and quarantined 0033 remain unchanged. Applied VPS 0031/0032 remain untouched.

**Not apply-ready:** exact staging catalog preflight, durable Hotel session/catalogue prerequisites, test-only payment transport, private guest document retention, and SQL/concurrency regressions must be completed first. See the accompanying staging design report. The acknowledgement in 0034b is an operator guard, not proof of environment isolation.

Guest authorization uses the linked private Hotel row's hash; no parent guest hash is added or read for Hotel payment ownership. Parent references remain FF-XXXXXXXX, with lookup determined by booking_type rather than prefix. No provider port or fulfilment worker is installed.
