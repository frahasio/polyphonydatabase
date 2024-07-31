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
		});
		colourClefs(this);
		console.log(tally);
		$(this).closest('.body-row').find('.voice-count input').val(tally);
	});
});

// Colour code clef inputs
function colourClefs(e) {
	if ($(e).val().indexOf("[") !== -1) {
		$(e).css('background-color','#ff8b797d');
	} else if ($(e).val().indexOf("{") !== -1) {
		$(e).css('background-color','#4ff5317d');
	} else if ($(e).val().indexOf("(") !== -1) {
		$(e).css('background-color','#edebeb');
	} else if ($(e).val().indexOf("/") !== -1) {
		$(e).css('background-color','#ffffff');
		$(e).css('border','1px solid #46c6eb');
	} else if (!$(e).val()) {
		$(e).css('background-color','#ffffff');
		$(e).css('border','none');
	} else if (($(e).val().length > 2 && $(e).val().indexOf("/") == -1 && $(e).val().indexOf("[") == -1 && $(e).val().indexOf("(") == -1 || $(e).val().indexOf(" ") !== -1)) {
		$(e).css('background-color','#ffffff');
		$(e).css('border','1px solid red');
	} else {
		$(e).css('background-color','#ffffff');
		$(e).css('border','1px solid #737373');
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
		var inp_index = $(':focus').closest('.body-row').find('.clefs input[type=text]').index($(':focus')) + 1;
		var siblings_count = $(':focus').closest('.body-row').find('.clefs input[type=text]').length;
		var single_row_index = inp_index;
		while (single_row_index > 8) {
			single_row_index = single_row_index - 8;
		};
		var in_reverse = 9 - single_row_index;
		var this_row = $(':focus').closest('.body-row').index('.body-row');
		console.log(inp_index + ' | ' + siblings_count + ' | ' + single_row_index + ' | ' + in_reverse + ' | ' + this_row);
		if (e.keyCode == 38) {  // MOVE UP
			if (inp_index <= 8) {
				$('.body-row').eq(this_row - 1).find('.clefs > span:nth-last-of-type(' + in_reverse + ')').find('input[type=text]').focus();
			} else {
				$('.body-row').eq(this_row).find('.clefs > span:nth-of-type(' + (inp_index - 8) + ')').find('input[type=text]').focus();
			}
		}
		if (e.keyCode == 40) {  // MOVE DOWN
			if (siblings_count >= (inp_index + 8)) {
				$('.body-row').eq(this_row).find('.clefs > span:nth-of-type(' + (inp_index + 8) + ')').find('input[type=text]').focus();
			} else {
				$('.body-row').eq(this_row + 1).find('.clefs > span:nth-of-type(' + single_row_index + ')').find('input[type=text]').focus();
			}
		}
	}
    }
);
