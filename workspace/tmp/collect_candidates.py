import subprocess
import json

def run_js(js_code):
    escaped = js_code.replace('"', '\\"')
    applescript = f'''
tell application "Google Chrome"
    set resultText to execute tab 2 of window 1 javascript "{escaped}"
    return resultText
end tell'''
    result = subprocess.run(['osascript', '-e', applescript], capture_output=True, text=True)
    return result.stdout.strip()

# Build the school lists for matching
schools985 = ['清华大学','北京大学','浙江大学','上海交通大学','复旦大学','南京大学','中国科学技术大学','哈尔滨工业大学','西安交通大学','武汉大学','华中科技大学','中山大学','四川大学','南开大学','天津大学','山东大学','东南大学','吉林大学','厦门大学','同济大学','北京师范大学','国防科技大学','中国人民大学','北京航空航天大学','北京理工大学','中国农业大学','兰州大学','电子科技大学','华南理工大学','大连理工大学','西北工业大学','东北大学','中南大学','湖南大学','重庆大学','华东师范大学','中央民族大学','中国海洋大学','西北农林科技大学']

qs100 = ['新加坡国立','南洋理工','东京大学','京都大学','香港大学','香港中文','香港科技','香港理工','香港城市','首尔国立','剑桥大学','牛津大学','帝国理工','伦敦大学学院','爱丁堡大学','曼彻斯特','伦敦国王','布里斯托','华威','格拉斯哥','利兹','伯明翰','南安普顿','杜伦','麻省理工','斯坦福大学','哈佛大学','加州理工','芝加哥','宾夕法尼亚','杜克','西北大学','约翰霍普金斯','康奈尔大学','哥伦比亚大学','加州伯克利','加州洛杉矶','加州圣地亚哥','密歇根','纽约大学','卡内基梅隆','华盛顿大学','多伦多大学','麦吉尔','UBC','墨尔本','悉尼','新南威尔士','澳国立','昆士兰','莫纳什','苏黎世联邦','洛桑联邦','巴黎理工','慕尼黑工业','代尔夫特','阿姆斯特丹']

# School names as JS array string
schools985_js = ','.join([f'"{s}"' for s in schools985])
qs100_js = ','.join([f'"{s}"' for s in qs100])

# Comprehensive collection script
js_collect = f'''
(function() {{
    var iframe = document.querySelector('iframe');
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    var cards = doc.querySelectorAll('li');
    var names = doc.querySelectorAll('.name');
    var results = [];
    
    var schools985 = [{schools985_js}];
    var qs100 = [{qs100_js}];
    
    for(var i = 0; i < cards.length; i++) {{
        var nameEl = cards[i].querySelector('.name');
        if(!nameEl) continue;
        var name = nameEl.innerText.trim();
        var cardText = cards[i].innerText;
        var btn = cards[i].querySelector('.btn.btn-greet');
        
        // Check if already greeted
        if(btn && (btn.innerText.indexOf('继续沟通') >= 0 || btn.innerText.indexOf('已沟通') >= 0)) continue;
        if(!btn) continue;
        
        // Check education
        var found985 = false;
        var foundQS100 = false;
        var lines = cardText.split('\\n');
        var school = '';
        var company = '';
        var expText = '';
        
        for(var j = 0; j < lines.length; j++) {{
            var line = lines[j].trim();
            // Check schools
            for(var k = 0; k < schools985.length; k++) {{
                if(line.indexOf(schools985[k]) >= 0) {{
                    found985 = true;
                    school = schools985[k];
                    break;
                }}
            }}
            if(!found985) {{
                for(var m = 0; m < qs100.length; m++) {{
                    if(line.indexOf(qs100[m]) >= 0) {{
                        foundQS100 = true;
                        school = qs100[m];
                        break;
                    }}
                }}
            }}
            // Check for x年 experience
            if(line.indexOf('年') >= 0 && line.indexOf('岁') < 0) {{
                expText = line;
            }}
        }}
        
        // Check for 27届/2027
        var is27 = cardText.indexOf('27届') >= 0 || cardText.indexOf('2027') >= 0;
        if(is27) continue;
        
        results.push(name + '||' + (found985 ? '985:' : (foundQS100 ? 'QS100:' : 'other:')) + school + '||' + cardText.substring(0,200));
    }}
    return String(results.join('\\n---\\n'));
}})()
'''

result = run_js(js_collect)
print(result)
