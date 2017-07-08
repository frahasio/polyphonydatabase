module Admin
  class InclusionsController < AdminControllerBase
    def destroy
      inclusion = Inclusion.find(params[:id])

      piece = inclusion.piece

      unless inclusion.destroy
        flash[:error] = inclusion.errors.full_messages.to_sentence
      end

      piece.reload

      if piece.inclusions.count == 0
        unless piece.destroy
          flash[:error] += (" and " + piece.errors.full_messages.to_sentence)
        end
      end

      redirect_to edit_admin_source_path(inclusion.source)
    end
  end
end
