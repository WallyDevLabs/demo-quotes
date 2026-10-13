import { createHash } from "node:crypto";
import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { base32Decode, totpCode, totpStepAt } from "../../src/server/auth/crypto";

/**
 * The PRD's end-to-end run: a brand-new install goes from nothing to a recorded payment, and the
 * received amount shows on the dashboard. One run, in order, against a production build.
 *   setup and two-factor, settings, client, project, estimate, quotation (sent, accepted),
 *   deposit invoice (issued), payment, dashboard, PDFs, sign out and back in.
 */

const johannesburgYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric" }).format(new Date());
const EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery staple 42";
const PIN = "2580";

/** Waits for the page to finish loading so React has attached its handlers before anything is clicked. */
const settle = (page: Page) => page.waitForLoadState("networkidle");
const save = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).click();

test("estimate to quotation, acceptance, deposit invoice and payment, then the dashboard", async ({ page, context, baseURL, browser }) => {
  let recoveryCodes: string[] = [];
  let quotationId = "";
  let invoiceId = "";
  let estimateId = "";
  let clientId = "";
  let projectId = "";

  await test.step("a signed-out visitor is sent to set up the owner account", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });

  await test.step("create the account (setup token required), then turn on two-factor", async () => {
    await settle(page);
    await page.locator("#setup-email").fill(EMAIL);
    await page.locator("#setup-password").fill(PASSWORD);
    await page.locator("#setup-confirm").fill(PASSWORD);
    await page.locator("#setup-token").fill("e2e-setup-token");
    await save(page, "Create account and continue");
    await expect(page).toHaveURL(/\/setup\/2fa$/);
    await settle(page);

    // Read the key the way a person would, and compute the code the way an authenticator app does.
    const keyText = (await page.locator(".money", { hasText: /^[A-Z2-7 ]{30,}$/ }).first().innerText()).replace(/\s/g, "");
    const code = totpCode(base32Decode(keyText), totpStepAt(Date.now()));
    await page.locator("#enroll-code").fill("000000");
    await save(page, "Confirm and turn on two-factor");
    await expect(page.getByText("That code is not correct").first()).toBeVisible(); // a wrong code is refused
    await page.locator("#enroll-code").fill(code);
    await save(page, "Confirm and turn on two-factor");

    await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
    recoveryCodes = await page.locator('[aria-label="Recovery codes"] li').allInnerTexts();
    expect(recoveryCodes).toHaveLength(8);
    await expect(page.getByRole("button", { name: "Continue to the app" })).toBeDisabled();
    await page.getByLabel("I have saved my recovery codes").check();
    await page.getByRole("button", { name: "Continue to the app" }).click();

    // A PIN is chosen next; it also marks this browser as trusted.
    await expect(page).toHaveURL(/\/setup\/pin$/);
    await settle(page);
    await page.locator("#pin-new").fill("1234");
    await page.locator("#pin-confirm").fill("1234");
    await page.locator("#pin-password").fill(PASSWORD);
    await save(page, "Save PIN and trust this device");
    await expect(page.getByText("not a run of digits")).toBeVisible(); // an obvious PIN is refused
    await page.locator("#pin-new").fill(PIN);
    await page.locator("#pin-confirm").fill(PIN);
    await save(page, "Save PIN and trust this device");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  await test.step("settings: business, ZAR rates and banking, and the default payment schedule", async () => {
    await page.goto("/settings");
    await settle(page);
    await page.locator("#legalName").fill("Katlego Barayi");
    await page.locator("#email").fill("hello@example.com");
    await page.locator("#address").fill("12 Jacaranda Rd, Pretoria");
    await save(page, "Save");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await page.getByRole("tab", { name: "Rates" }).click();
    await page.locator("#rate-development").fill("600");
    await page.locator("#rate-design").fill("500");
    await page.locator("#minrate").fill("550");
    await page.locator("#bank-bankName").fill("First National Bank");
    await page.locator("#bank-accountName").fill("Katlego Barayi");
    await page.locator("#bank-accountNumber").fill("62000000000");
    await page.locator("#bank-branchCode").fill("250655");
    await save(page, "Save ZAR settings");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await page.getByRole("tab", { name: "Defaults" }).click();
    await page.locator("#urg").fill("20");
    await page.locator("#cont").fill("10");
    await page.getByRole("button", { name: "Add milestone" }).click();
    await page.getByRole("button", { name: "Add milestone" }).click();
    await page.getByLabel("Milestone 1 name").fill("Deposit");
    await page.getByLabel("Milestone 1 percent").fill("50");
    await page.getByLabel("Milestone 2 name").fill("On delivery");
    await page.getByLabel("Milestone 2 percent").fill("50");
    await save(page, "Save");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  });

  await test.step("a client and a project", async () => {
    await page.goto("/clients/new");
    await settle(page);
    await page.locator("#c-name").fill("Thabo Mokoena");
    await page.locator("#c-companyName").fill("Acme (Pty) Ltd");
    await page.locator("#c-email").fill("thabo@acme.test");
    await page.locator("#c-code").fill("acme");
    await save(page, "Create client");
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    clientId = page.url().split("/").pop()!;

    await page.goto("/projects/new");
    await settle(page);
    await page.locator("#p-client").selectOption({ label: "Thabo Mokoena" });
    await page.locator("#p-name").fill("Dispatch web app");
    await page.locator("#p-code").fill("disp");
    await page.locator("#p-desc").fill("A web app for dispatching drivers and tracking deliveries.");
    await save(page, "Create project");
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    projectId = page.url().split("/").pop()!;
  });

  await test.step("estimate: the PRD worked example prices to exactly R37 069.00", async () => {
    await page.goto("/estimates/new");
    await settle(page);
    await page.locator("#e-project").selectOption({ index: 1 });
    await page.locator("#e-title").fill("Phase 1 build");

    await page.locator("[id^=l-task-]").first().fill("Development");
    await page.locator("[id^=l-hrs-]").first().fill("40");
    await page.getByRole("button", { name: "Add labour line" }).click();
    await page.locator("[id^=l-task-]").nth(1).fill("Design");
    await page.locator("[id^=l-cat-]").nth(1).selectOption("design");
    await page.locator("[id^=l-hrs-]").nth(1).fill("10");
    // The default rates come from Settings, not from the code.
    await expect(page.locator("[id^=l-rate-]").first()).toHaveValue("600.00");
    await expect(page.locator("[id^=l-rate-]").nth(1)).toHaveValue("500.00");

    await page.getByRole("button", { name: "Add expense" }).click();
    await page.locator("[id^=x-d-]").first().fill("Hosting");
    await page.locator("[id^=x-c-]").first().fill("1200");
    await page.locator("[id^=x-m-]").first().fill("10");

    await page.getByLabel("Urgent delivery").check();
    await expect(page.locator("#e-cont")).toHaveValue("10.00"); // the default from Settings
    await page.getByLabel("Discount type").selectOption("percent");
    await page.getByLabel("Discount value").fill("5");

    await expect(page.getByTestId("summary-total")).toHaveText("R37 069.00");
    await save(page, "Save draft");
    await expect(page).toHaveURL(/\/estimates\/[0-9a-f-]{36}$/);
    estimateId = page.url().split("/").pop()!;
    await settle(page);
    await expect(page.getByTestId("summary-total")).toHaveText("R37 069.00");

    await page.getByRole("button", { name: "Mark ready" }).click();
    await expect(page.getByText("Ready for quotation")).toBeVisible();
  });

  await test.step("quotation: create from the estimate, send it, mark it accepted", async () => {
    await page.getByRole("button", { name: "Create quotation" }).click();
    await expect(page).toHaveURL(/\/quotations\/[0-9a-f-]{36}$/);
    quotationId = page.url().split("/").pop()!;
    await settle(page);
    await page.locator("#q-time").fill("8 weeks from receipt of the deposit");
    await save(page, "Save draft");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await page.getByRole("button", { name: "Send quotation…" }).click();
    await page.getByRole("button", { name: "Send and freeze" }).click();
    await expect(page.getByRole("heading", { name: `QUO${johannesburgYear}0001` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();

    await page.getByRole("button", { name: "Mark accepted" }).click();
    await page.locator("#acc-by").fill("Thabo Mokoena");
    await page.getByRole("button", { name: "Record acceptance" }).click();
    await expect(page.getByText("Accepted on")).toBeVisible();
  });

  await test.step("the quotation's own figures add up (the hand-check page)", async () => {
    await page.goto(`/quotations/${quotationId}/working`);
    await expect(page.getByText("Every internal check passes")).toBeVisible();
    await expect(page.getByText("FAIL")).toHaveCount(0);
  });

  await test.step("invoice: the deposit milestone is invoiced, issued and paid", async () => {
    await page.goto(`/quotations/${quotationId}`);
    await settle(page);
    const card = page.locator("section", { hasText: "One accepted quotation can produce several invoices" });
    await expect(card).toContainText("R37 069.00");
    await page.getByRole("button", { name: "Create invoice for Deposit" }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    invoiceId = page.url().split("/").pop()!;
    await settle(page);

    await page.getByRole("button", { name: "Issue invoice…" }).click();
    await page.getByRole("button", { name: "Issue and freeze" }).click();
    await expect(page.getByRole("heading", { name: `INV${johannesburgYear}0001` })).toBeVisible();

    // An overpayment is refused; the full balance is accepted.
    await page.locator("#pay-amount").fill("18534.51");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("more than the outstanding balance of R18 534.50")).toBeVisible();
    await page.getByRole("button", { name: "Full balance" }).click();
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(page.locator("h1 + span")).toHaveText("Paid");
  });

  await test.step("dashboard: invoiced and received are shown apart, and the received amount is right", async () => {
    await page.goto("/");
    const zar = page.locator('section[aria-label="ZAR figures"]');
    const tile = (label: string) => zar.locator("div", { has: page.getByText(label, { exact: true }) }).first();
    await expect(tile("Confirmed")).toContainText("R37 069.00");
    await expect(tile("Invoiced")).toContainText("R18 534.50");
    await expect(tile("Received")).toContainText("R18 534.50");
    await expect(tile("Outstanding")).toContainText("R0.00");
  });

  await test.step("the stored PDFs are real, are served unchanged, and need a session", async () => {
    for (const path of [`/quotations/${quotationId}/pdf`, `/invoices/${invoiceId}/pdf`]) {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("application/pdf");
      const body = await res.body();
      expect(body.subarray(0, 5).toString()).toBe("%PDF-");
      expect(res.headers()["etag"]).toBe(`"${createHash("sha256").update(body).digest("hex")}"`);
    }
    const anon = await pwRequest.newContext({ baseURL });
    for (const path of [`/quotations/${quotationId}/pdf`, `/invoices/${invoiceId}/pdf`, "/audit"]) {
      const res = await anon.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain("/login");
    }
    await anon.dispose();
  });

  await test.step("the audit log recorded the status changes", async () => {
    await page.goto("/audit");
    for (const action of ["status.sent", "status.accepted", "status.issued", "auth.enroll_2fa"]) {
      await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
    }
  });

  await test.step("on a phone: every page fits the screen, and the burger menu navigates", async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    const pages = [
      "/", "/estimates", `/estimates/${estimateId}`, "/estimates/new", `/estimates/${estimateId}/working`,
      "/clients", `/clients/${clientId}`, "/clients/new", "/projects", `/projects/${projectId}`, "/projects/new",
      "/quotations", `/quotations/${quotationId}`, `/quotations/${quotationId}/working`,
      "/invoices", `/invoices/${invoiceId}`, "/settings", "/audit", "/account",
    ];
    const wide: string[] = [];
    for (const path of pages) {
      await page.goto(path);
      await settle(page);
      const over = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad = [...document.querySelectorAll("body *")]
          .filter((el) => {
            if (el.getBoundingClientRect().right <= vw + 1) return false;
            // Wide content that scrolls inside its own box (a table, the tab strip) is fine; only the page itself must not.
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              if (["auto", "scroll"].includes(getComputedStyle(a).overflowX)) return false;
            }
            return true;
          })
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
        return { overflow: document.documentElement.scrollWidth > vw + 1, bad };
      });
      if (over.overflow) wide.push(`${path} -> ${over.bad.join(" | ")}`);
      await page.screenshot({ path: `test-results/mobile${path.replace(/[^a-z]+/gi, "_")}.png`, fullPage: true });
    }
    expect(wide, "pages wider than the phone screen").toEqual([]);

    // The burger opens the drawer; choosing a link navigates and closes it.
    await page.goto("/");
    await settle(page);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.screenshot({ path: "test-results/mobile-drawer.png" });
    await page.getByRole("dialog").getByRole("link", { name: "Invoices" }).click();
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();

    // The theme button flips the theme and carries an icon, not a word.
    const toggle = page.getByRole("button", { name: /Switch to (dark|light) theme/ }).first();
    await expect(toggle.locator("svg").first()).toBeAttached();
    const before = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await toggle.click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(!before);
    await page.screenshot({ path: "test-results/mobile-theme-toggled.png" });
    await toggle.click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: "test-results/desktop.png" });
  });

  await test.step("sign out; this trusted device signs back in with the PIN alone", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/login\?next=%2Finvoices$/);
    await settle(page);

    await expect(page.locator("#login-code")).toHaveCount(0); // no authenticator code on a trusted device
    await page.locator("#login-pin").fill("9999");
    await expect(page.getByText("That PIN is not correct. 4 of 5 tries left")).toBeVisible();
    await page.locator("#login-pin").fill(PIN);
    await expect(page).toHaveURL(/\/invoices$/); // back to where they were going
    await expect(page.getByText(`INV${johannesburgYear}0001`).first()).toBeVisible();
  });

  await test.step("a new device needs the password and a code, then is trusted too", async () => {
    const other = await browser.newContext({ baseURL });
    const p2 = await other.newPage();
    await p2.goto("/login");
    await settle(p2);
    await expect(p2.locator("#login-pin")).toHaveCount(0); // never seen: no PIN screen
    await p2.locator("#login-email").fill(EMAIL);
    await p2.locator("#login-password").fill(PASSWORD);
    await p2.locator("#login-code").fill("000000");
    await save(p2, "Sign in");
    await expect(p2.getByText("That email, password or code is not correct.")).toBeVisible();
    await p2.locator("#login-code").fill(recoveryCodes[0]!);
    await save(p2, "Sign in");
    await expect(p2).toHaveURL(/\/$/);
    await expect(p2.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Signed out there, the same device now asks only for the PIN.
    await p2.getByRole("button", { name: "Sign out" }).click();
    await expect(p2).toHaveURL(/\/login/);
    await settle(p2);
    await expect(p2.locator("#login-pin")).toBeVisible();
    await other.close();
  });

  await test.step("five wrong PINs remove the device and bring back the full form", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await settle(page);
    const wrongPins = ["1357", "2468", "9753", "8642"];
    for (const [i, wrong] of wrongPins.entries()) {
      await page.locator("#login-pin").fill(wrong);
      await expect(page.getByText(`${4 - i} of 5 tries left`)).toBeVisible();
    }
    await page.locator("#login-pin").fill("1593"); // the fifth
    await expect(page.locator("#login-code")).toBeVisible();
    await expect(page.getByText("This device is no longer trusted")).toBeVisible();
    await page.locator("#login-email").fill(EMAIL);
    await page.locator("#login-password").fill(PASSWORD);
    await page.locator("#login-code").fill(recoveryCodes[1]!);
    await page.locator("#login-trust").uncheck(); // a shared computer: no trust, no PIN
    await save(page, "Sign in");
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step("the session cookie is httpOnly, and the page carries a Content Security Policy", async () => {
    const cookie = (await context.cookies()).find((c) => c.name.includes("session"));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    const res = await page.request.get("/login");
    expect(res.headers()["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });
});
