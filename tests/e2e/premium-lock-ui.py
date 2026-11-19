"""Real browser check for locked, owned, child and keyboard body-picker behavior.

Requires a Vite dev server in this checkout and Python Playwright. The owned
profile is an isolated UI test double, not a real entitlement or purchase.
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

base=os.environ['TERRA_TEST_URL'].rstrip('/')
out=Path(os.environ['TERRA_TEST_OUT']);out.mkdir(parents=True,exist_ok=True)
executable=os.environ.get('TERRA_CHROMIUM') or None
result=[]

def check(name, condition):
    result.append({'check':name,'worked':bool(condition)})
    print(('WORKED ' if condition else 'FAILED ')+name,flush=True)
    if not condition:raise AssertionError(name)

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        try:
            for age,owned in [('adult',False),('under13',False),('unknown',False),('adult',True)]:
                page=browser.new_page(viewport={'width':1280,'height':900})
                page.goto(f'{base}/tests/e2e/premium-lock-fixture.html?age={age}&owned={int(owned)}',wait_until='networkidle')
                premium=page.locator('.sh-bodies__group').first.locator('[data-body]').first
                ident=premium.get_attribute('data-body');group=page.locator('.sh-bodies__group').first
                check(f'{age}/{owned}: premium group visible',premium.is_visible())
                if not owned:
                    check(f'{age}: locked semantic state',premium.get_attribute('aria-disabled')=='true')
                    text=group.inner_text()
                    check(f'{age}: coming soon shown','Coming soon' in text)
                    check(f'{age}: correct price privacy',('1,200 GG' in text) == (age=='adult'))
                    page.locator('[data-body="classic"]').focus();page.keyboard.press('ArrowRight')
                    check(f'{age}: arrow can focus locked tile without selecting',page.evaluate('() => document.activeElement?.getAttribute("data-body")')==ident and page.locator('#selected').inner_text()=='classic')
                    page.keyboard.press('Enter');page.keyboard.press('Space')
                    check(f'{age}: keyboard cannot select locked',page.locator('#selected').inner_text()=='classic')
                    box=premium.bounding_box();page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2)
                    check(f'{age}: pointer cannot select locked',page.locator('#selected').inner_text()=='classic')
                else:
                    check('owned tile enabled',premium.get_attribute('aria-disabled') is None)
                    premium.click();check('owned premium selects',page.locator('#selected').inner_text()==ident)
                kit=page.locator('.sh-bodies__group').nth(1).locator('[data-body]').first
                kitid=kit.get_attribute('data-body');kit.click();check(f'{age}/{owned}: kit remains free',page.locator('#selected').inner_text()==kitid)
                page.locator('[data-body="classic"]').click();check(f'{age}/{owned}: classic remains free',page.locator('#selected').inner_text()=='classic')
                page.screenshot(path=str(out/f'picker-{age}-owned{int(owned)}.png'),full_page=True)
                page.close()
            # Real game store, separate fresh profile: child can see the card
            # but it has no purchase action, and a direct purchase is rejected.
            page=browser.new_page(viewport={'width':1280,'height':900})
            page.goto(base+'/',wait_until='domcontentloaded')
            page.wait_for_function("() => window.__afterlife?.game?.screen === 'menu'",timeout=180000)
            age=page.locator('.st-age-dialog .st-age__input')
            age.fill(str(page.evaluate('() => new Date().getFullYear() - 8')))
            page.locator('.st-age-dialog').get_by_role('button',name='Continue',exact=True).click()
            page.locator('.sh-menu__item',has_text='Store').click()
            page.get_by_role('tab',name='Bodies',exact=True).click()
            card=page.locator(f'[data-sku="body:{ident}"]');card.wait_for()
            check('child store premium card has no purchase button',card.locator('button').count()==0)
            denied=page.evaluate('''async id => await window.__afterlife.game.economy.purchaseGG('body:'+id)''',ident)
            check('child direct purchase is refused',denied.get('ok') is False)
            page.screenshot(path=str(out/'child-store.png'));page.close()
        finally:browser.close()
finally:
    (out/'premium-lock-ui.json').write_text(json.dumps(result,indent=2))
