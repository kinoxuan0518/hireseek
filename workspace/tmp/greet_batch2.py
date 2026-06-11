import subprocess
import time

names = ['张启帆', '王耀毅', '黄正阳', '杨恒毅', '方略', '杨晨']

for name in names:
    js_code = f'''var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var cards=doc.querySelectorAll('li'); var result=''; for(var ci=0;ci<cards.length;ci++){{var nameEl=cards[ci].querySelector('.name'); if(nameEl&&nameEl.innerText.trim()=='{name}'){{var btns=cards[ci].querySelectorAll('[class*=btn]'); for(var bi=0;bi<btns.length;bi++){{if(btns[bi].innerText.trim()=='打招呼'){{btns[bi].click();result='clicked';break}}}}if(result==''){{result='no_greet_btn'}}break}} String(result)'''
    
    escaped = js_code.replace('"', '\\"')
    script = f'tell app "Google Chrome" to execute tab 2 of window 1 javascript "{escaped}"'
    
    r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=15)
    result = r.stdout.strip()
    print(f'{name}: {result}')
    if result == 'clicked':
        time.sleep(2.5)
    elif result == 'no_greet_btn':
        print(f'  -> already greeted')
