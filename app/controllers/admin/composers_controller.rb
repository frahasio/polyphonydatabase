module Admin
  class ComposersController < AdminControllerBase
    def new
    end

    def create
      composer = Composer.create(composer_params)

      unless composer.persisted?
        flash[:error] = composer.errors.full_messages.to_sentence
      end

      redirect_to new_admin_composer_path
    end

    def edit
      @composer = Composer.find(params[:id])

      @unique_pieces = @composer.inclusions.map do |inclusion|
        UniquePiece.find_or_initialize_by(
          title: inclusion&.piece&.title,
          composers: inclusion.composers.pluck(:id).join(","),
          minimum_voices: inclusion.minimum_voice_count,
        )
      end

      @unique_pieces.each do |unique_piece|
        unique_piece.editions.build
        unique_piece.recordings.build
      end
    end

    def update
      composer = Composer.find(params[:id])

      unless composer.update(composer_params)
        flash[:error] = composer.errors.full_messages.to_sentence
      end

      redirect_to edit_admin_composer_path(composer)
    end

    def switch_to
      redirect_to edit_admin_composer_path(params[:id])
    end

  private

    def composer_params
      params.require(:composer).permit(
        :aliased_as,
        :birthplace_1,
        :birthplace_2,
        :deathplace_1,
        :deathplace_2,
        :from_year_annotation,
        :from_year,
        :image_url,
        :name,
        :to_year_annotation,
        :to_year,
      )
    end
  end
end
