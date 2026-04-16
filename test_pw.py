from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://311.boston.gov/tickets/new?submission%5Bticket_type_code%5D=Public+Works+Department%3AHighway+Maintenance%3ARequest+for+Pothole+Repair")
    page.wait_for_timeout(3000)
    print(page.content())
    browser.close()
