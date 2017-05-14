class ComposersController < ApplicationController
  def new
  end

  def create
    composer = Composer.create(composer_params)

    unless composer.persisted?
      flash[:error] = composer.errors.full_messages.to_sentence
    end

    redirect_to new_composer_path
  end

  def edit
    @composer = Composer.find(params[:id])
  end

  def update
    composer = Composer.find(params[:id])

    unless composer.update(composer_params)
      flash[:error] = composer.errors.full_messages.to_sentence
    end

    redirect_to new_composer_path
  end

private

  def composer_params
    params.require(:composer).permit(:name)
  end
end
