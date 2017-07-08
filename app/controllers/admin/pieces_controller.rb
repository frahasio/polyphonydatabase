module Admin
  class PiecesController < AdminControllerBase
    def update
      piece = Piece.find(params[:id])

      unless piece.update(piece_params)
        flash[:error] = piece.errors.full_messages.to_sentence
      end

      if params[:composer_id]
        redirect_to edit_admin_composer_path(id: params[:composer_id])
      else
        # This can change to `redirect_to edit_admin_piece_path(piece)`
        # if you ever have a page just for editing pieces.
        redirect_to admin_root_path
      end
    end

  private

    def piece_params
      params.require(:piece).permit(
        :title,
        feasts: [],
        editions_attributes: [
          :editor,
          :file_url,
          :id,
          :voicing,
        ],
        recordings_attributes: [
          :file_url,
          :id,
          :performer,
        ],
      )
    end
  end
end
