class ComposersController < ApplicationController
  def new
  end

  def create
    composer = Composer.create!(composer_params)

    redirect_to edit_composer_path(composer)
  end

  def edit
    @composer = Composer.find(params[:id])
  end

  def update
    composer = Composer.find(params[:id])
    composer.update_attributes(composer_params)

    redirect_to new_composer_path
  end

private

  def composer_params
    params.require(:composer).permit(:name)
  end
end
