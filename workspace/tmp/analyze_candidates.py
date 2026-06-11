import subprocess
import json
import re

def run_apple(js):
    """Run JavaScript in BOSS tab and return result"""
    as_script = f'''
tell application "Google Chrome"
    set resultText to execute tab 2 of window 1 javascript "{js}"
    return resultText
end tell'''
    result = subprocess.run(['osascript', '-e', as_script], capture_output=True, text=True)
    return result.stdout.strip()

# Get all candidate card data
js = '''
(function() {
    var iframe = document.querySelector('iframe');
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    var cards = doc.querySelectorAll('li');
    var result = [];
    
    for(var ci = 0; ci < cards.length; ci++) {
        var card = cards[ci];
        var nameEl = card.querySelector('.name');
        if(!nameEl) continue;
        var name = nameEl.innerText.trim();
        var btn = card.querySelector('.btn.btn-greet');
        if(!btn) continue;
        
        var text = card.innerText;
        var first200 = text.substring(0, 200).replace(/\\n/g, ' ');
        
        result.push(name + '|' + first200);
    }
    return result.join('\\n');
})()
'''

result = run_apple(js)
print(result)
