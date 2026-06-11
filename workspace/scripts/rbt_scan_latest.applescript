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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var ul=doc.querySelector('ul.recommend-card-list');if(!ul){return 'no_ul';}var lis=ul.querySelectorAll('li');var r='total='+lis.length;for(var i=0;i<lis.length;i++){var txt=lis[i].innerText;var btn=lis[i].querySelector('.btn-greet');r+='||'+i+':'+txt.substring(0,80).replace(/\\n/g,' | ')+'|btn='+(btn?'Y':'N');}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell