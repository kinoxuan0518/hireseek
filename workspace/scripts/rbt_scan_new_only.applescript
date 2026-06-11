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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var r='';var schools985=['清华大学','北京大学','复旦大学','上海交通大学','浙江大学','南京大学','中国科学技术大学','哈尔滨工业大学','西安交通大学','电子科技大学','北京理工大学','武汉大学','华中科技大学','东南大学','北京航空航天大学','同济大学','南开大学'];var schoolsQS=['滑铁卢','香港中文','香港大学','香港科技','港理工','港城','新加坡国立','南洋理工','加州大学','加州理工','卡内基','纽约大学','南加州','波士顿','密歇根','多伦多','UBC','剑桥','牛津','帝国理工','伦敦大学','爱丁堡','曼彻斯特','麻省','斯坦福','哈佛','康奈尔','哥伦比亚','宾夕法尼亚','西北大学','杜克','约翰霍普金斯','芝加哥','华盛顿大学','墨尔本','悉尼','澳国立'];for(var i=0;i<cards.length;i++){var txt=cards[i].innerText;if(txt.indexOf('btn-greet')<0&&!cards[i].querySelector('.btn-greet')){continue;}var lines=txt.split('\\n');var name=lines[0];for(var j=0;j<lines.length;j++){var l=lines[j];if(l.indexOf('K')<0&&l.indexOf('面议')<0&&l.indexOf('岁')<0&&l.length>0&&l.length<10){name=l;break;}}var has985=false;var hasQS=false;var hasAgent=txt.indexOf('agent')>=0||txt.indexOf('Agent')>=0||txt.indexOf('RAG')>=0||txt.indexOf('LLM')>=0||txt.indexOf('大模型')>=0||txt.indexOf('LangChain')>=0||txt.indexOf('Prompt')>=0||txt.indexOf('Function calling')>=0||txt.indexOf('Multi-agent')>=0;var is27=txt.indexOf('27年')>=0||txt.indexOf('28年')>=0||txt.indexOf('29年')>=0;for(var j=0;j<lines.length;j++){for(var k=0;k<schools985.length;k++){if(lines[j].indexOf(schools985[k])>=0){has985=true;break;}}for(var k=0;k<schoolsQS.length;k++){if(lines[j].indexOf(schoolsQS[k])>=0){hasQS=true;break;}}}var pass=(hasAgent||has985||hasQS)&&!is27;if(pass){r+=i+':'+name.trim()+'|agent='+(hasAgent?'Y':'N')+'|985='+(has985?'Y':'N')+'|QS='+(hasQS?'Y':'N')+'\n';}}return r||'none';})()"
	set r to execute tab_ javascript js
	return r
end tell