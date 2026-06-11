tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "
var iframe = document.querySelector('iframe');
var doc = iframe.contentDocument || iframe.contentWindow.document;
var allEls = doc.querySelectorAll('.name, .item-body, li');
var candidates = [];
var seen = {};

var schools985 = ['清华大学','北京大学','浙江大学','上海交通大学','复旦大学','南京大学','中国科学技术大学','哈尔滨工业大学','西安交通大学','武汉大学','华中科技大学','中山大学','四川大学','南开大学','天津大学','山东大学','东南大学','吉林大学','厦门大学','同济大学','北京师范大学','国防科技大学','中国人民大学','北京航空航天大学','北京理工大学','中国农业大学','兰州大学','电子科技大学','华南理工大学','大连理工大学','西北工业大学','东北大学','中南大学','湖南大学','重庆大学','华东师范大学'];

var qs100 = ['新加坡国立','南洋理工','东京大学','京都大学','香港大学','香港中文','香港科技','香港理工','香港城市','首尔国立','剑桥大学','牛津大学','帝国理工','伦敦大学学院','爱丁堡大学','曼彻斯特','伦敦国王','布里斯托','华威','格拉斯哥','利兹','伯明翰','南安普顿','杜伦','麻省理工','斯坦福大学','哈佛大学','加州理工','芝加哥','宾夕法尼亚','杜克','西北大学','约翰霍普金斯','康奈尔大学','哥伦比亚大学','加州伯克利','加州洛杉矶','加州圣地亚哥','密歇根','纽约大学','卡内基梅隆','华盛顿大学','多伦多大学','麦吉尔','墨尔本','悉尼','新南威尔士','澳国立','昆士兰','莫纳什','苏黎世联邦','洛桑联邦','巴黎理工','慕尼黑工业','代尔夫特','阿姆斯特丹'];

var cards = doc.querySelectorAll('li');
var output = [];

for(var ci = 0; ci < cards.length; ci++) {
    var card = cards[ci];
    var nameEl = card.querySelector('.name');
    if(!nameEl) continue;
    var name = nameEl.innerText.trim();
    if(seen[name]) continue;
    seen[name] = true;
    
    var btn = card.querySelector('.btn.btn-greet');
    if(!btn) continue;
    var btnText = btn.innerText.trim();
    if(btnText.indexOf('继续沟通') >= 0 || btnText.indexOf('已沟通') >= 0) continue;
    
    var text = card.innerText;
    var lines = text.split('\\n');
    
    var school = '';
    var company = '';
    var expYears = -1;
    var is985 = false;
    var isQS100 = false;
    var is27 = false;
    var undergradSchool = '';
    
    for(var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        
        if(line.indexOf('27届') >= 0 || line.indexOf('2027') >= 0 || line.indexOf('28届') >= 0) {
            is27 = true;
        }
        
        for(var k = 0; k < schools985.length; k++) {
            if(line.indexOf(schools985[k]) >= 0) {
                is985 = true;
                school = schools985[k];
                // Check if this looks like an undergrad line (本科 or no 硕士/博士)
                if(line.indexOf('本科') >= 0 || (line.indexOf('硕士') < 0 && line.indexOf('博士') < 0)) {
                    undergradSchool = schools985[k];
                }
            }
        }
        for(var m = 0; m < qs100.length; m++) {
            if(line.indexOf(qs100[m]) >= 0) {
                isQS100 = true;
                if(school == '') school = qs100[m];
                if(line.indexOf('本科') >= 0 || (line.indexOf('硕士') < 0 && line.indexOf('博士') < 0)) {
                    if(undergradSchool == '') undergradSchool = qs100[m];
                }
            }
        }
        
        if(line.indexOf('年经验') >= 0 || line.indexOf('年工作') >= 0) {
            var parts = line.match(/(\d+)年/);
            if(parts) expYears = parseInt(parts[1]);
        }
        if(line.indexOf('应届生') >= 0 || line.indexOf('应届') >= 0) {
            if(expYears < 0) expYears = 0;
        }
    }
    
    // If we saw 985 or qs100 school, try to find undergrad
    // Look for education lines with year ranges (like 2019 2023 format)
    for(var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        // Education line usually has year-year pattern
        if(line.match(/\\d{4}\\s+\\d{4}/) || line.match(/\\d{4}\\s+-\\s+\\d{4}/)) {
            for(var k = 0; k < schools985.length; k++) {
                if(line.indexOf(schools985[k]) >= 0) {
                    if(undergradSchool == '') undergradSchool = schools985[k];
                }
            }
            for(var m = 0; m < qs100.length; m++) {
                if(line.indexOf(qs100[m]) >= 0) {
                    if(undergradSchool == '') undergradSchool = qs100[m];
                }
            }
        }
    }
    
    output.push(name + '|school:' + school + '|985:' + is985 + '|QS100:' + isQS100 + '|undergrad:' + undergradSchool + '|exp:' + expYears + '|is27:' + is27 + '|btn:' + btnText);
}
String(output.join('\\n'))
"
	return resultText
end tell