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

      @grouped_inclusions = UniquePiece.group(@composer.inclusions)

      @grouped_inclusions.each do |unique_piece, _|
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
