# Use case run, 2026-11-13 18:49

Against https://alexe.pt/maps/. Profiles: phone 390x664, phone-small 375x553. Cases: docs/use-cases.md; script: tools/e2e/usecases.py.

| Id | Use case | phone | phone-small |
|---|---|---|---|
| C3 | Timeline views | FAIL: All (11) shows fewer rows than Key (12) | pass |
| D3 | 3D | ERROR: TimeoutError: Page.wait_for_selector: Timeout 30000ms exceeded. | ERROR: TimeoutError: Page.wait_for_selector: Timeout 30000ms exceeded. |
| H2 | Everything tappable | ERROR: TimeoutError: Page.wait_for_selector: Timeout 30000ms exceeded. | ERROR: TimeoutError: Page.wait_for_selector: Timeout 30000ms exceeded. |
