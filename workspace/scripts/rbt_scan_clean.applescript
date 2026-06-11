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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var r=[];for(var i=0;i<cards.length;i++){var txt=cards[i].innerText;var btn=cards[i].querySelector('.btn-greet');if(!btn)continue;var name=txt.split('\\n')[1]||txt.split('\\n')[0];var hasAgent=txt.indexOf('Agent')>=0||txt.indexOf('agent')>=0||txt.indexOf('LLM')>=0||txt.indexOf('大模型')>=0||txt.indexOf('RAG')>=0||txt.indexOf('LangChain')>=0;var is27=txt.indexOf('27年')>=0;var has985=txt.indexOf('清华')>=0||txt.indexOf('北大')>=0||txt.indexOf('复旦')>=0||txt.indexOf('上海交大')>=0||txt.indexOf('浙大')>=0||txt.indexOf('南大')>=0||txt.indexOf('中科大')>=0||txt.indexOf('哈工大')>=0||txt.indexOf('西安交大')>=0||txt.indexOf('电子科大')>=0||txt.indexOf('东南')>=0;var hasQS=txt.indexOf('滑铁卢')>=0||txt.indexOf('香港')>=0||txt.indexOf('新加坡')>=0||txt.indexOf('卡内基')>=0||txt.indexOf('纽约')>=0||txt.indexOf('波士顿')>=0||txt.indexOf('多伦多')>=0||txt.indexOf('UBC')>=0||txt.indexOf('加州')>=0||txt.indexOf('哥伦比亚')>=0||txt.indexOf('密歇根')>=0||txt.indexOf('康奈尔')>=0||txt.indexOf('宾夕')>=0||txt.indexOf('杜克')>=0||txt.indexOf('西北')>=0||txt.indexOf('芝加哥')>=0||txt.indexOf('帝国')>=0||txt.indexOf('伦敦')>=0||txt.indexOf('剑桥')>=0||txt.indexOf('麻省')>=0||txt.indexOf('斯坦福')>=0||txt.indexOf('哈佛')>=0||txt.indexOf('墨尔本')>=0||txt.indexOf('悉尼')>=0||txt.indexOf('澳国立')>=0;if((hasAgent||has985||hasQS)&&!is27){r.push(i+':'+name.trim()+'|ag='+(hasAgent?'Y':'N')+'|985='+(has985?'Y':'N')+'|QS='+(hasQS?'Y':'N'));}}return r.join('||');})()"
	set r to execute tab_ javascript js
	return r
end tell