// Submit a 311 ticket via Playwright browser automation
import { chromium, Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";

const CATEGORY_MAP: Record<string, string> = {
  pothole: "Pothole",
  graffiti: "Illegal Graffiti",
  trash: "Litter",
  litter: "Litter",
  "trash can": "Overflowing Trash Can",
  "overflowing trash": "Overflowing Trash Can",
  sidewalk: "Broken Sidewalk",
  streetlight: "Street Light Outage",
  "street light": "Street Light Outage",
  sign: "Damaged Sign",
  tree: "Fallen Tree or Branches",
  rodent: "Rodent Sighting",
  rat: "Rodent Sighting",
  noise: "Other",
  parking: "Illegal Parking",
  abandoned: "Abandoned Vehicle",
  needle: "Needle Cleanup",
  other: "Other",
};

export function matchCategory(input: string): string {
  const lower = input.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return "Other";
}

let browser: Browser | null = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export async function submit311Ticket(params: {
  category: string;
  description: string;
  address: string;
  photoPath?: string;
}): Promise<{ success: boolean; ticketId?: string; url?: string; error?: string }> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // Step 1: Select category
    const categoryLabel = matchCategory(params.category);
    console.log(`[311] Starting submission: ${categoryLabel} at ${params.address}`);
    await page.goto("https://311.boston.gov/reports/new");
    await page.waitForLoadState("networkidle");
    await page.selectOption("select", { label: categoryLabel });
    await page.click("text=Next");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Step 2: Fill description + optional photo
    await page.fill(
      'textarea[name="submission[details][spot:description]"]',
      params.description
    );

    if (params.photoPath && fs.existsSync(params.photoPath)) {
      console.log(`[311] Uploading photo: ${params.photoPath}`);
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(params.photoPath);
      await page.waitForTimeout(2000);
      console.log("[311] Photo uploaded");
    } else {
      console.log(`[311] No photo to upload (path: ${params.photoPath || "none"})`);
    }

    await page.click('input[value="Next"]');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Step 3: Enter address — type slowly to trigger autocomplete
    const locationInput = page.locator(
      'input[name="submission[details][spot:location][_input]"]'
    );
    await locationInput.click();
    await locationInput.fill("");
    await page.keyboard.type(params.address, { delay: 50 });
    await page.waitForTimeout(3000);

    // Try to click a Google Places autocomplete suggestion
    const pacItem = page.locator(".pac-item").first();
    if (await pacItem.isVisible().catch(() => false)) {
      await pacItem.click();
      await page.waitForTimeout(1500);
    }

    // Click Next
    await page.click('input[value="Next"]');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Step 4: "Confirm Location" page — pick the best Boston match
    const pageTextNow = (await page.locator("body").textContent()) || "";
    if (pageTextNow.includes("Confirm Location") || pageTextNow.includes("choose a location")) {
      // Find all forms with Choose submit buttons
      const forms = page.locator("form:has(input[value='Choose'])");
      const formCount = await forms.count();

      let clicked = false;
      for (let i = 0; i < formCount; i++) {
        const formText = await forms.nth(i).textContent() || "";
        if (formText.includes("Boston")) {
          await forms.nth(i).locator("input[value='Choose']").click();
          clicked = true;
          break;
        }
      }
      // Fallback: click the first one
      if (!clicked && formCount > 0) {
        await forms.first().locator("input[value='Choose']").click();
      }

      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }

    // Step 5: Contact Information — uncheck "Include Contact" to skip it
    console.log(`[311] Reached step 5. URL: ${page.url()}`);

    const contactCheckbox = page.locator('input[type="checkbox"]').first();
    if (await contactCheckbox.isVisible().catch(() => false)) {
      if (await contactCheckbox.isChecked()) {
        await contactCheckbox.uncheck();
        await page.waitForTimeout(500);
      }
    }

    // Click Next to get to review page
    const nextBtn = page.locator('input[value="Next"]');
    if ((await nextBtn.count()) > 0) {
      await nextBtn.first().click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }

    // Step 6: Review page — click Submit
    console.log(`[311] Review page. URL: ${page.url()}`);
    await page.screenshot({ path: "311-review.png", fullPage: true });

    // Find and click the Submit button — could be input or button element
    const submitBtn = page.locator('input[value="Submit"], button:has-text("Submit"), [type="submit"][value="Submit"]');
    const submitCount = await submitBtn.count();
    console.log(`[311] Found ${submitCount} submit buttons`);

    if (submitCount > 0) {
      await submitBtn.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await submitBtn.first().click({ force: true });
      console.log("[311] Clicked Submit");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(4000);
    } else {
      // Fallback: try clicking any submit-type button on the page
      const anySubmit = page.locator('[type="submit"]').last();
      if ((await anySubmit.count()) > 0) {
        const val = await anySubmit.getAttribute("value");
        console.log(`[311] Fallback: clicking submit with value="${val}"`);
        await anySubmit.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(4000);
      }
    }

    await page.screenshot({ path: "311-submitted.png", fullPage: true });
    console.log(`[311] After submit. URL: ${page.url()}`);

    // Check for success — URL should change to a ticket page
    const finalUrl = page.url();
    const confirmText = (await page.locator("body").textContent()) || "";

    if (finalUrl.includes("/tickets/") && !finalUrl.includes("/new")) {
      // Success — we're on the ticket page
      const ticketMatch = confirmText.match(/#(\d+)/);
      return {
        success: true,
        ticketId: ticketMatch ? ticketMatch[1] : undefined,
        url: finalUrl,
      };
    }

    // Check for error messages
    if (confirmText.includes("NOT SAVED")) {
      const errorMatch = confirmText.match(/NOT SAVED\s*(.*?)(?:\n|$)/);
      return {
        success: false,
        error: `311 rejected the submission: ${errorMatch?.[1]?.trim() || "invalid data"}. Make sure the address is in Boston.`,
      };
    }

    return {
      success: false,
      error: `Submission may have failed. URL: ${finalUrl}`,
    };
  } catch (e) {
    console.error(`[311] Error:`, e);
    await page.screenshot({ path: "311-error.png", fullPage: true }).catch(() => {});
    return { success: false, error: String(e) };
  } finally {
    await page.close();
  }
}

// Test it standalone
if (require.main === module) {
  submit311Ticket({
    category: "pothole",
    description: "Large pothole on the corner, about 2 feet wide",
    address: "100 Tremont St Boston",
  }).then((result) => {
    console.log("Result:", JSON.stringify(result, null, 2));
  });
}
