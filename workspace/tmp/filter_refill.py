import subprocess
import time

def click_option(text):
    script = f'''tell application "Google Chrome"
    set r to execute tab 2 of window 1 javascript "var d=document.querySelector('iframe').contentDocument||document.querySelector('iframe').contentWindow.document; var opts=d.querySelectorAll('.option'); for(var i=0;i<opts.length;i++){{if(opts[i].innerText.trim()=='{text}'){{opts[i].click();'clicked';break}}}} 'notfound'"
    return r
end tell'''
    r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=15)
    return r.stdout.strip()

def click_confirm():
    script = '''tell application "Google Chrome"
    set r to execute tab 2 of window 1 javascript "var d=document.querySelector('iframe').contentDocument||document.querySelector('iframe').contentWindow.document; var btns=d.querySelectorAll('.btn'); for(var i=0;i<btns.length;i++){{if(btns[i].innerText.trim()=='确认'){{btns[i].click();'confirmed';break}}}} 'notfound'"
    return r
end tell'''
    r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=15)
    return r.stdout.strip()

items = ['25年毕业', '26年毕业', '1年以内', '1-3年', '本科', '硕士', '博士']
for item in items:
    r = click_option(item)
    print(f'{item}: {r}')
    time.sleep(0.3)

time.sleep(0.5)
r = click_confirm()
print(f'Confirm: {r}')
