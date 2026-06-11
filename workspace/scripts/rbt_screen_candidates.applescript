tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var a985=['清华大学','北京大学','复旦大学','上海交通大学','浙江大学','南京大学','中国科学技术大学','哈尔滨工业大学','西安交通大学'];var aQS100=['新加坡国立','南洋理工','东京大学','京都大学','香港大学','香港中文','香港科技','香港理工','香港城市','首尔国立','剑桥大学','牛津大学','帝国理工','伦敦大学学院','爱丁堡大学','曼彻斯特','伦敦国王','布里斯托','华威','格拉斯哥','利兹','伯明翰','南安普顿','杜伦','麻省理工','斯坦福大学','哈佛大学','加州理工','芝加哥','宾夕法尼亚','杜克','西北大学','约翰霍普金斯','康奈尔大学','哥伦比亚大学','加州伯克利','加州洛杉矶','加州圣地亚哥','密歇根','纽约大学','卡内基梅隆','华盛顿大学','多伦多大学','麦吉尔','UBC','墨尔本','悉尼','新南威尔士','澳国立','昆士兰','莫纳什','苏黎世联邦','洛桑联邦','慕尼黑工业','代尔夫特','阿姆斯特丹','滑铁卢'];var agentKeywords=['agent','Agent','AGENT','RAG','LangChain','LangGraph','LLM','Prompt Engineering','Multi-agent','function calling','tool use','智能体','大模型应用','AI Agent'];var r='';for(var i=0;i<cards.length&&i<15;i++){var txt=cards[i].innerText;var lines=txt.split('\\n');var name=lines[0]||'';var has985=false;var hasQS100=false;var hasAgent=false;var isExp=false;var expLine='';for(var j=0;j<lines.length;j++){var l=lines[j];for(var k=0;k<a985.length;k++){if(l.indexOf(a985[k])>=0){has985=true;break;}}for(var k=0;k<aQS100.length;k++){if(l.indexOf(aQS100[k])>=0){hasQS100=true;break;}}for(var k=0;k<agentKeywords.length;k++){if(l.indexOf(agentKeywords[k])>=0){hasAgent=true;break;}}if(l.indexOf('年')>=0&&(l.indexOf('经验')>=0||l.indexOf('工作')>=0)){expLine=l;}}var passSchool=has985||hasQS100;var passAgent=hasAgent;var btn=cards[i].querySelector('.btn-greet');r+=i+':'+name+'|school='+(passSchool?'Y':'N')+'|agent='+(passAgent?'Y':'N')+'|exp='+expLine+'\\n';}return r;})()"
	set result to execute tab_ javascript js
	return result
end tell