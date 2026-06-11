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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var r='total='+cards.length;for(var i=15;i<cards.length;i++){var txt=cards[i].innerText;var lines=txt.split('\\n');var name=lines[1]||'unk';var btn=cards[i].querySelector('.btn-greet');var has985=false;var hasQS100=false;var hasAgent=txt.indexOf('agent')>=0||txt.indexOf('Agent')>=0||txt.indexOf('RAG')>=0||txt.indexOf('LLM')>=0||txt.indexOf('大模型')>=0;if(txt.indexOf('滑铁卢')>=0||txt.indexOf('香港中文')>=0||txt.indexOf('浙江')>=0){hasQS100=true;}r+='||'+i+':'+name.trim()+'|btn='+(btn?'Y':'N')+'|agent='+(hasAgent?'Y':'N')+'|school='+(hasQS100?'Y':'N');}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell