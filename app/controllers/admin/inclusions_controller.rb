module Admin
  class InclusionsController < AdminControllerBase
    def destroy
      inclusion = Inclusion.find(params[:id])

      composition = inclusion.composition

      unless inclusion.destroy
        flash[:error] = inclusion.errors.full_messages.to_sentence
      end

      composition.reload

      if composition.inclusions.empty?
        unless composition.destroy
          flash[:error] += (" and " + composition.errors.full_messages.to_sentence)
        end
      end

      redirect_to edit_admin_source_path(inclusion.source)
    end
  end
end
