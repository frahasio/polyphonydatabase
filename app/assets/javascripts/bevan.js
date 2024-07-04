// Autofill composers with values in first inclusion row
$( document ).ready(function(){
	$('.autofill-composers').click(function(){
		$('ul.composer li:first-child input').val($('ul.composer:first li:first-child input').val());
		$('ul.composer li:first-child select').val($('ul.composer:first li:first-child select').val());
	});
	$('.autofill-type').click(function(){
		$('.col.type select').val($('.col.type:first select').val());
	});
	$('.autofill-tone').click(function(){
		$('.col.tone select').val($('.col.tone:first select').val());
	});
	$('.autofill-even-odd').click(function(){
		$('.col.even-odd select').val($('.col.even-odd:first select').val());
	});
});

// Hide the autofill box when clicking away
$( document ).ready(function(){
	$('input[name="title"]').on('focusout blur', function(){
		$(this).siblings('ul').attr('hidden',true);
	});
});

// Autoupdate voice count input as clefs are changed
$( document ).ready(function(){
	$('.clefs input').on('change focus', function(e){
	    	var tally = 0;
		$(this).closest('.body-row').find('.clefs input').each(function(i,e) {
			if (!$(e).val() || $(e).attr('type') == 'hidden' || $(e).val().indexOf("(") !== -1 || $(e).val().indexOf(")") !== -1 || $(e).val().indexOf("bc") !== -1 || $(e).val().indexOf("lut") !== -1 || $(e).val().indexOf("org") !== -1) {
				// do nothing
			} else {
				tally = tally + 1;
			};
			colourClefs(e);
		});
		console.log(tally);
		$(this).closest('.body-row').find('.voice-count input').val(tally);
	});
});

// Colour code clef inputs
function colourClefs(e) {
	if ($(e).val().indexOf("[") !== -1) {
		e.css('background-color','#ff8b797d');
	} else if ($(e).val().indexOf("{") !== -1) {
		e.css('background-color','#4ff5317d');
	} else if ($(e).val().indexOf("/") !== -1) {
		e.css('background-color','#5cd9ff78');
	} else if ($(e).val().indexOf("/") !== -1) {
		e.css('background-color','#a1afb378');
	}		
}	
$( document ).ready(function(){
	$('.clefs input').each(function(i,e) {
		colourClefs(e);
	});
});

// Toggle menu with burger button
$( document ).ready(function(){
	$('.burger').click(function(){
		$(this).parents('.nav').toggleClass('open');
	})
});

// Show extra attribution input
$( document ).ready(function(){
	$('.another-att-trigger').click(function(){
		$(this).siblings('.composer').find('li:last-of-type').addClass('visible');
	})
});

// Use arrow keys to move around clef inputs in source editor
$(document).keydown(
    function(e) {
	if ($(':focus').parent().parent().hasClass('clefs')) {
		var inp = $(':focus').parent().index();
		var sib = $(':focus').parent().siblings().length;
		var row = $(':focus').closest('.body-row').index('.body-row');
		var prevrow = $('.body-row').eq(row - 1).find('.clefs').children('input').length;
		if (e.keyCode == 38) {  //MOVE UP
			if (inp < 8) {
				if (prevrow > 32) {
					row = row + 32;
				} else if (prevrow > 24) {
					row = row + 24;
				} else if (prevrow > 16) {
					row = row + 16;
				} else if (prevrow > 8) {
					row = row + 8;
				}
			} else {
				if (sib > 7) {
					inp = inp - 8;
					row = row + 1;
				}
			}
			$('.body-row').eq(row - 1).find('.clefs').children().eq(inp).children('input[type=text]').focus();
		}
		if (e.keyCode == 40) {    //MOVE DOWN
			if (sib > 31) {
				if (inp > 31) {
					inp = inp - 32;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			} else if (sib > 23) {
				if (inp > 23) {
					inp = inp - 24;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			} else if (sib > 15) {
				if (inp > 15) {
					inp = inp - 16;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			} else if (sib > 7) {
				if (inp > 7) {
					inp = inp - 8;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			}
			$('.body-row').eq(row + 1).find('.clefs').children().eq(inp).children('input[type=text]').focus();
		}
	}
    }
);
