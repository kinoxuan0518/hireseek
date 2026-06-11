"""
Greet qualified candidates for Agent开发工程师 position.
Qualification: 985/QS100 in ANY education line, 0-3 years, not 27+
"""
import subprocess
import time

def run_js(js_code):
    """Execute JavaScript in BOSS tab and return result"""
    escaped = js_code.replace('"', '\\"').replace('\n', ' ')
    applescript = f'''
tell application "Google Chrome"
    set resultText to execute tab 2 of window 1 javascript "{escaped}"
    return resultText
end tell'''
    result = subprocess.run(['osascript', '-e', applescript], capture_output=True, text=True, timeout=30)
    return result.stdout.strip()

def greet_candidate(name):
    """Click the greeting button for a specific candidate by name"""
    js = f'''
(function() {{
    var iframe = document.querySelector('iframe');
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    var cards = doc.querySelectorAll('li');
    for(var ci = 0; ci < cards.length; ci++) {{
        var nameEl = cards[ci].querySelector('.name');
        if(!nameEl) continue;
        if(nameEl.innerText.trim() != '{name}') continue;
        var btn = cards[ci].querySelector('.btn.btn-greet');
        if(!btn) return 'no_button';
        if(btn.innerText.indexOf('继续沟通') >= 0) return 'already_greeted';
        btn.click();
        return 'clicked';
    }}
    return 'not_found';
}})()
'''
    return run_js(js)

def check_quota():
    """Check current greeting quota from data page"""
    js = '''
(function() {
    var links = document.querySelectorAll('a');
    for(var i = 0; i < links.length; i++) {
        if(links[i].href && links[i].href.indexOf('data-recruit') >= 0) {
            links[i].click();
            return 'navigating';
        }
    }
    return 'no_link';
})()
'''
    return run_js(js)

# Qualified candidates in order of priority
qualified = [
    ("吴其乐", "北大+南洋理工, 微软+Agent, 最匹配"),
    ("江禛钰", "西交985, Ali Java, Agentscope/Langgraph"),
    ("何应丰原", "UCSD+UCLA, 2年, AI Agent"),
    ("邓佳淇", "哈工大(985), KAIST, AI专业"),
    ("张可欣", "天大985, 1年, 智能体平台"),
    ("常迈", "上交985, AI专业, 港理工硕士"),
    ("熊文韬", "哈工大985, 2年, CUDA/系统"),
    ("王晨", "UW-Madison, 2年, Java"),
    ("杨淞", "同济985, 26届, AI Coding Agent"),
]

print("Starting to greet qualified candidates...")
for name, reason in qualified:
    result = greet_candidate(name)
    print(f"{name}: {result} ({reason})")
    if result == 'clicked':
        time.sleep(2.5)  # Wait 2.5s between clicks per E4
    elif result == 'already_greeted':
        print(f"  -> Already greeted, skipping")
    elif result == 'not_found':
        print(f"  -> Not found in current view")
    elif result == 'no_button':
        print(f"  -> No greeting button available")

print("\nDone greeting batch.")
