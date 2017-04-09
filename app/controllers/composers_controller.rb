class ComposersController < ApplicationController
  def new

  end

  def create
    composer = Composer.create!(composer_params)

    redirect_to edit_composer_path(composer)
  end

  def edit

  end

private

  def composer_params
    params.require(:composer).permit(:name)
  end
end
