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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var r=[];for(var i=0;i<cards.length;i++){var txt=cards[i].innerText;var btn=cards[i].querySelector('.btn-greet');if(!btn)continue;var lines=txt.split('\\n');var name=lines[1]||lines[0];var hasA=txt.indexOf('Agent')>=0||txt.indexOf('agent')>=0||txt.indexOf('LLM')>=0||txt.indexOf('大模型')>=0||txt.indexOf('RAG')>=0;var is27=txt.indexOf('27年')>=0;var hasS=txt.indexOf('浙大')>=0||txt.indexOf('东南')>=0||txt.indexOf('滑铁卢')>=0||txt.indexOf('香港')>=0||txt.indexOf('新加坡')>=0||txt.indexOf('加州')>=0||txt.indexOf('卡内基')>=0||txt.indexOf('纽约')>=0||txt.indexOf('波士顿')>=0||txt.indexOf('布朗')>=0||txt.indexOf('多伦多')>=0||txt.indexOf('UBC')>=0;if((hasA||hasS)&&!is27){r.push(i+':'+name.trim());}}return r.join('||')||'none';})()"
	set r to execute tab_ javascript js
	return r
end tell