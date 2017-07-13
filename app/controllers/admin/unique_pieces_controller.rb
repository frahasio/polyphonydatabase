module Admin
  class UniquePiecesController < AdminControllerBase
    def create
      unique_piece = UniquePiece.create(unique_piece_params)

      unless unique_piece.persisted?
        flash[:error] = unique_piece.errors.full_messages.to_sentence
      end

      if params[:composer_id]
        redirect_to edit_admin_composer_path(id: params[:composer_id])
      else
        # This can change to `redirect_to edit_admin_unique_piece_path(unique_piece)`
        # if you ever have a page just for editing unique_pieces.
        redirect_to admin_root_path
      end
    end

    def update
      unique_piece = UniquePiece.find(params[:id])

      unless unique_piece.update(unique_piece_params)
        flash[:error] = unique_piece.errors.full_messages.to_sentence
      end

      if params[:composer_id]
        redirect_to edit_admin_composer_path(id: params[:composer_id])
      else
        # This can change to `redirect_to edit_admin_unique_piece_path(unique_piece)`
        # if you ever have a page just for editing unique_pieces.
        redirect_to admin_root_path
      end
    end

  private

    def unique_piece_params
      params.require(:unique_piece).permit(
        :composers,
        :minimum_voices,
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
