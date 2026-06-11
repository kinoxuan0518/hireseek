import subprocess
import sys

def click_filter_item(item_text):
    applescript = f'''
tell application "Google Chrome"
    set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var options=doc.querySelectorAll('.option'); var found=''; for(var i=0;i<options.length;i++) {{ var t=options[i].innerText.trim(); if(t=='{item_text}') {{ options[i].click(); found='clicked'; break; }} }} String(found || 'not_found')"
    return resultText
end tell'''
    result = subprocess.run(['osascript', '-e', applescript], capture_output=True, text=True)
    return result.stdout.strip()

def get_active_filters():
    applescript = '''
tell application "Google Chrome"
    set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var options=doc.querySelectorAll('.option.active'); var texts=''; for(var i=0;i<options.length;i++) { texts=texts+options[i].innerText.trim()+',' } String(texts)"
    return resultText
end tell'''
    result = subprocess.run(['osascript', '-e', applescript], capture_output=True, text=True)
    return result.stdout.strip()

def click_confirm():
    applescript = '''
tell application "Google Chrome"
    set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var btns=doc.querySelectorAll('div.btn'); for(var i=0;i<btns.length;i++) { if(btns[i].innerText.trim()=='确定') { btns[i].click(); String('confirmed'); break; } } String('not_found')"
    return resultText
end tell'''
    result = subprocess.run(['osascript', '-e', applescript], capture_output=True, text=True)
    return result.stdout.strip()

# Click experience items
items_to_click = ['25年毕业', '26年毕业', '1年以内', '1-3年']
for item in items_to_click:
    r = click_filter_item(item)
    print(f"Clicked {item}: {r}")
    
import time
time.sleep(0.5)

active = get_active_filters()
print(f"Active filters after experience: {active}")

# Click education items
for item in ['本科', '硕士', '博士']:
    r = click_filter_item(item)
    print(f"Clicked {item}: {r}")
    time.sleep(0.3)

time.sleep(0.5)
active = get_active_filters()
print(f"Active filters after all: {active}")
