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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var r='total='+cards.length;for(var i=0;i<cards.length&&i<60;i++){var txt=cards[i].innerText;var lines=txt.split('\\n');var name=lines[1]||'unk';var btn=cards[i].querySelector('.btn-greet');var hasAgent=txt.indexOf('agent')>=0||txt.indexOf('Agent')>=0||txt.indexOf('RAG')>=0||txt.indexOf('LLM')>=0||txt.indexOf('大模型')>=0||txt.indexOf('LangChain')>=0||txt.indexOf('Prompt')>=0;var hasQS=txt.indexOf('滑铁卢')>=0||txt.indexOf('香港')>=0||txt.indexOf('新加坡')>=0||txt.indexOf('浙江')>=0||txt.indexOf('加州')>=0||txt.indexOf('卡内基')>=0||txt.indexOf('纽约')>=0||txt.indexOf('南加州')>=0||txt.indexOf('波士顿')>=0||txt.indexOf('西北')>=0||txt.indexOf('杜克')>=0||txt.indexOf('康奈尔')>=0||txt.indexOf('哥大')>=0||txt.indexOf('宾夕')>=0||txt.indexOf('密歇')>=0||txt.indexOf('多伦多')>=0||txt.indexOf('UBC')>=0||txt.indexOf('伦敦')>=0||txt.indexOf('帝国')>=0||txt.indexOf('剑桥')>=0||txt.indexOf('牛津')>=0||txt.indexOf('麻省')>=0||txt.indexOf('斯坦福')>=0||txt.indexOf('哈佛')>=0||txt.indexOf('ETH')>=0;var has985=txt.indexOf('清华大学')>=0||txt.indexOf('北京大学')>=0||txt.indexOf('复旦大学')>=0||txt.indexOf('上海交通大学')>=0||txt.indexOf('浙江大学')>=0||txt.indexOf('南京大学')>=0||txt.indexOf('中国科学技术')>=0||txt.indexOf('哈尔滨工业大学')>=0||txt.indexOf('西安交通大学')>=0||txt.indexOf('电子科技大学')>=0||txt.indexOf('北京理工')>=0||txt.indexOf('武汉大学')>=0||txt.indexOf('华中科技')>=0||txt.indexOf('东南大学')>=0||txt.indexOf('北京航空')>=0||txt.indexOf('同济')>=0||txt.indexOf('南开')>=0;var pass=(hasAgent||has985||hasQS);var is27=txt.indexOf('27年')>=0||txt.indexOf('28年')>=0;r+='||'+i+':'+name.trim()+'|btn='+(btn?'Y':'N')+'|pass='+(pass?'Y':'N')+'|agent='+(hasAgent?'Y':'N')+'|985='+(has985?'Y':'N')+'|QS='+(hasQS?'Y':'N')+'|27='+(is27?'Y':'N');}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell