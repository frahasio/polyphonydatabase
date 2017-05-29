class InclusionsController < ApplicationController
  def destroy
    inclusion = Inclusion.find(params[:id])

    unless inclusion.destroy
      flash[:error] = inclusion.errors.full_messages.to_sentence
    end

    redirect_to edit_source_path(inclusion.source)
  end
end
